'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ctx=vm.createContext({});
for(const file of ['building-inputs','thermal-model','reservation-model','reservation-profile','environment-dataset','zone-lighting-model','control-scenario-model'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../data',file+'.js'),'utf8'),ctx);
const m=vm.runInContext('controlScenarioModel',ctx),data=vm.runInContext('environmentDataset',ctx),a=vm.runInContext('reservationArtifact',ctx);
const near=(x,y)=>assert.ok(Math.abs(x-y)<1e-7,`${x} != ${y}`),p=m.plant();
const r={slot:20,floorReservationProxy:20,outdoorTemperatureC:32,southVerticalIrradianceWm2:800};
const off=m.requestStep(23.8,r,20,42,false,p),on=m.requestStep(23.8,r,20,42,true,p);
near(off.temperatureC,m.advanceTemperature(23.8,32,off.gainsW,0,p));
near(on.temperatureC,m.advanceTemperature(23.8,32,on.gainsW,on.coolingW,p));
near(on.energyKwh,on.hvacKwh+on.lightingKwh);
assert.ok(on.coolingW<=p.ratedSensibleCoolingW&&on.temperatureC>=23-1e-7);
const cold=m.requestStep(20,{...r,outdoorTemperatureC:12,southVerticalIrradianceWm2:0},0,0,true,p);
assert.equal(cold.coolingW,0);assert.ok(cold.temperatureC<23);
// Shared on/off holds, including a denied early return.
const state=m.requestState();assert.equal(m.applyRequest(state,true,0,p.settings).changed,true);
assert.equal(m.applyRequest(state,false,4,p.settings).on,true);
assert.equal(m.applyRequest(state,false,5,p.settings).on,false);
assert.equal(m.applyRequest(state,true,9,p.settings).on,false);
assert.equal(m.applyRequest(state,true,10,p.settings).on,true);
// With the same occupied room, future count alone changes the present action.
const low={...a,floorWeight:0,floorProfile:Array(48).fill(10)},high={...a,floorWeight:0,floorProfile:Array(48).fill(314)};
const memory={on:true,lastChangeMinute:600};
const declining=m.predictiveRequest(23,r,42,true,629,memory,p,low,29),rising=m.predictiveRequest(23,r,42,true,629,memory,p,high,29);
assert.equal(declining.wanted,false);assert.equal(rising.wanted,true);
assert.ok(rising.forecastHeatW>declining.forecastHeatW);
const projection=m.forecastInputs(r,high,15,p);
assert.equal(projection.people[0],20);assert.equal(projection.people[14],20);assert.equal(projection.people[15],314);
// Objective-only terms never become actual electricity.
const candidate=m.evaluateRequest(true,23.6,r,42,629,memory,p,projection);
near(candidate.objectiveKwh,candidate.energyKwh+candidate.terminalEquivalentKwh);
const records=data.records.filter(r=>r.date==='2026-06-29'),input={lightingPolicy:'fixed',leadMinutes:0};
const result=m.simulateDay(records,a,input),persistence=m.simulateDay(records,a,{...input,hvacForecast:'persistence'});
assert.equal(result.modes[2].preArrivalCoolingMinutes,0);
near(result.modes[0].hvacKwh,result.modes[1].hvacKwh);
assert.ok(result.modes[2].trace.some((t,i)=>t.people>0&&t.hvacRequestOn!==result.modes[1].trace[i].hvacRequestOn));
assert.ok(result.modes[2].trace.some((t,i)=>t.people>0&&t.hvacRequestOn!==persistence.modes[2].trace[i].hvacRequestOn));
for(const mode of result.modes) {
 near(mode.hvacKwh,mode.trace.reduce((sum,t)=>sum+t.hvacKw/60,0));
 near(mode.energyKwh,mode.hvacKwh+mode.lightingKwh);
 assert.ok(mode.trace.every(t=>t.coolingW>=0&&t.coolingW<=p.ratedSensibleCoolingW+1e-7));
 const changes=mode.trace.filter(t=>t.requestChanged);
 for(let i=1;i<changes.length;i++)assert.ok(changes[i].minute-changes[i-1].minute>=5);
 const satisfied=mode.trace.filter(t=>t.people>0&&Math.min(t.temperatureBeforeC,t.temperatureC)>=23-1e-7&&Math.max(t.temperatureBeforeC,t.temperatureC)<=24+1e-7).length;
 near(mode.temperatureCompliancePct,satisfied/mode.occupiedMinutes*100);
 assert.ok(mode.maximumOccupiedTemperatureC>24); // arrival violation is retained
}
const changed=records.map((r,i)=>({...r,...(i>=24?{floorReservationProxy:314,outdoorTemperatureC:45,southVerticalIrradianceWm2:1800}:{})}));
const future=m.simulateDay(changed,a,input);
for(let minute=0;minute<720;minute++)for(let i=0;i<3;i++) {
 assert.equal(future.modes[i].trace[minute].hvacRequestOn,result.modes[i].trace[minute].hvacRequestOn);
 near(future.modes[i].trace[minute].temperatureC,result.modes[i].trace[minute].temperatureC);
}
const ahead=m.simulateDay(records,a,{...input,leadMinutes:15});
assert.ok(ahead.modes[2].firstArrivalTemperatureC<result.modes[2].firstArrivalTemperatureC);
assert.ok(ahead.modes[2].preArrivalCoolingMinutes>0);
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
for(const id of ['controlHvacTime','controlHvacActions','controlHvacCandidates','controlHvacForecast','controlHvacMinOn','controlHvacMinOff'])assert.ok(html.includes(`id="${id}"`));
console.log('HVAC lookahead passed: room-state heat balance, shared request holds, occupied-period forecast influence, candidate cost / electricity separation, causal rollout, observed violations and pre-arrival choice.');
