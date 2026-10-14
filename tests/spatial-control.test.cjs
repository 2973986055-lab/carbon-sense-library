'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root=__dirname+'/..',ctx=vm.createContext({});
for(const n of ['building-inputs','reservation-model','reservation-profile','environment-dataset','spatial-occupancy-model','spatial-thermal-model','spatial-control-model'])vm.runInContext(fs.readFileSync(root+'/data/'+n+'.js','utf8'),ctx);
const m=vm.runInContext('spatialControlModel',ctx),thermal=vm.runInContext('spatialThermalModel',ctx),data=vm.runInContext('environmentDataset',ctx),artifact=vm.runInContext('reservationArtifact',ctx),forecast=vm.runInContext('reservationModel',ctx);
const plain=x=>JSON.parse(JSON.stringify(x)),near=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`),sum=a=>a.reduce((s,x)=>s+x,0);
const records=data.records.filter(r=>r.date==='2026-06-29'),r=records[20],pl=m.plant(),s=pl.settings;
// Shared affine fast path must match the accepted four-node integrator.
let plantCases=0,maxResidual=0;
for(const mask of [0,1,2,3])for(const served of [1,5,15])for(const before of [[24,24,24,24],[26,24,25,23.4]]){
  const counts=[40,0,40,0],a=pl.advance(before,r,counts,mask,served,true),b=thermal.step(before,r,counts,m.ids[mask],a.fraction,pl.parameters);
  a.temperaturesC.forEach((t,i)=>near(t,b.temperaturesC[i],1e-10));near(a.hvacKwh,b.hvacKwh);near(a.ledger.residualJ,0,1e-5);
  near(sum(a.zoneCoolingW),sum(a.unitCoolingW));assert.ok(a.fraction>=0&&a.fraction<=1);plantCases++;maxResidual=Math.max(maxResidual,Math.abs(a.ledger.residualJ));
}
// Holds are independent for each unit, and cannot be bypassed by swapping units.
let state=m.transition(m.memory(),1,400);assert.deepEqual(plain(m.allowed(state,404,s)),[1,3]);
state=m.transition(state,3,405);assert.deepEqual(plain(m.allowed(state,409,s)),[2,3]);
assert.ok(!m.allowed(m.memory(),s.endMinute-4,s).includes(3));assert.deepEqual(plain(m.allowed(m.memory(),s.endMinute,s)),[0]);
for(const input of [{minimumOnMinutes:4},{startMinute:400},{endMinute:360},{pattern:'left'},{forecastMode:'future-actual'}])assert.throws(()=>m.settings(input));
assert.throws(()=>m.simulateDay(records.slice(0,47),artifact));assert.throws(()=>m.decision('unknown',[24,24,24,24],r,[40,0,40,0],600,m.memory(),pl,artifact));
const projection=m.projection(r,artifact,625,[40,0,40,0],pl,30,'frozen');
assert.equal(sum(projection.steps[4].counts),80);assert.equal(sum(projection.steps[5].counts),forecast.transfer(artifact,r.slot,80).people);
assert.ok(projection.steps.every(step=>step.record===r));assert.equal(projection.usesFutureActual,false);
const currentRecord={...r,slot:20,floorReservationProxy:20},counts=[10,0,10,0],temperatures=[23.9,23.5,23.9,23.5],mem={mask:1,lastChange:[600,-Infinity]};
const low={...artifact,floorWeight:0,floorProfile:Array(48).fill(10)},high={...artifact,floorWeight:0,floorProfile:Array(48).fill(314)};
const realLow=m.decision('realtime',temperatures,currentRecord,counts,625,mem,pl,low),realHigh=m.decision('realtime',temperatures,currentRecord,counts,625,mem,pl,high);
assert.equal(realLow.mask,realHigh.mask,'Realtime cannot see the forecast');
const frozenBefore=JSON.stringify(artifact),result=m.simulateDay(records,artifact),ablation=m.ablation(records,artifact);
assert.equal(JSON.stringify(artifact),frozenBefore);
let actionDifferences=0,forecastDifferences=0,outputDifferences=0;
for(const mode of result.modes){
  near(mode.hvacKwh,sum(mode.trace.map(t=>t.hvacKwh)));near(mode.energyKwh,mode.hvacKwh+mode.lightingKwh);near(mode.ledger.residualJ,0,1e-3);
  assert.ok(mode.maxBalanceResidualJ<1e-5);assert.equal(mode.shutdownMask,0);assert.equal(mode.isMeasured,false);
  assert.ok(mode.trace.every(t=>t.minute>=390&&t.minute<1350));
  for(let unit=0;unit<2;unit++){
    const bit=1<<unit,changes=mode.decisions.filter((d,i)=>Boolean(d.mask&bit)!==Boolean((i?mode.decisions[i-1].mask:0)&bit));
    for(let i=1;i<changes.length;i++)assert.ok(changes[i].minute-changes[i-1].minute>=5);
    near(mode.unitRequestMinutes[unit],mode.trace.filter(t=>t.requestMask&bit).length);
  }
  const occupied=sum(mode.trace.map(t=>t.counts.filter(n=>n>0).length));near(mode.occupiedZoneMinutes,occupied);
  near(mode.temperatureCompliancePct,mode.withinRangeZoneMinutes/occupied*100);
  if(mode.maximumOccupiedViolationC>1e-6)assert.equal(mode.savingPct,null,'Cannot label violating trajectories as compliant savings');
  near(mode.terminalAdjustedDifferenceKwh,mode.hvacDifferenceFromBaselineKwh-mode.terminalEquivalentDifferenceKwh);
}
for(let i=0;i<result.modes[2].trace.length;i++){
  if(result.modes[2].trace[i].requestMask!==result.modes[1].trace[i].requestMask)actionDifferences++;
  if(result.modes[2].trace[i].requestMask!==ablation.trace[i].requestMask)forecastDifferences++;
  if(Math.abs(result.modes[2].trace[i].hvacKw-ablation.trace[i].hvacKw)>1e-7)outputDifferences++;
}
assert.ok(actionDifferences>0);assert.ok(forecastDifferences>0,'Frozen prediction must actually change present requests in the historical scenario');
assert.ok(outputDifferences>0,'Forecast effects must include delivered power, not only equivalent unit labels');
const changed=records.map(r=>r.slot>=30?{...r,floorReservationProxy:314,outdoorTemperatureC:40,southVerticalIrradianceWm2:1000}:r),future=m.simulateDay(changed,artifact);
for(let mode=0;mode<3;mode++)for(let i=0;i<result.modes[mode].trace.length;i++)if(result.modes[mode].trace[i].minute<900){
  assert.equal(future.modes[mode].trace[i].requestMask,result.modes[mode].trace[i].requestMask);
  result.modes[mode].trace[i].temperaturesC.forEach((t,j)=>near(t,future.modes[mode].trace[i].temperaturesC[j]));
}
const strong=m.simulateDay(records,artifact,{mixingWPerK:5000});assert.ok(strong.modes.every(mode=>mode.maximumOccupiedViolationC<1e-6));
assert.ok(result.modes.some(mode=>mode.maximumOccupiedViolationC>1),'Keep weak-mixing model failure visible');
const warm=m.simulateDay(records,artifact,{startMinute:390,endMinute:420,initialTemperatureC:28});assert.ok(warm.modes.every(mode=>mode.maximumOccupiedViolationC>=4));
const holds=m.simulateDay(records,artifact,{startMinute:390,endMinute:480,minimumOnMinutes:10,minimumOffMinutes:15});
for(const mode of holds.modes)for(let u=0;u<2;u++){
  let on=false,last=-Infinity;for(const d of mode.decisions){const next=Boolean(d.mask&(1<<u));if(next!==on){assert.ok(d.minute-last>=(on?10:15));on=next;last=d.minute;}}
  if(on)assert.ok(480-last>=10);
}
const html=fs.readFileSync(root+'/spatial-control-preview.html','utf8'),panel=fs.readFileSync(root+'/data/spatial-control-panel.js','utf8'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(ids.length,new Set(ids).size);new vm.Script(panel);
for(const match of panel.matchAll(/(?:get|write)\('([^']+)'\s*[,)]/g))assert.ok(ids.includes(match[1]),`Missing field ${match[1]}`);
for(const link of html.matchAll(/(?:src|href)="(data\/[^"?#]+)(?:\?[^"#]*)?"/g))assert.ok(fs.existsSync(root+'/'+link[1]));
assert.ok(!html.includes('data/zone-lighting-model.js')&&!html.includes('data/control-scenario-model.js'));
console.log(JSON.stringify({passed:true,plantCases,maxResidualJ:maxResidual,causalDayChecks:true,actionDifferences,forecastAblationDifferences:forecastDifferences,forecastOutputDifferences:outputDifferences,defaultFailureVisible:true,strongMixingIsScenarioOnly:true}));
