'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context=vm.createContext({});
for(const file of ['building-inputs','thermal-model','reservation-model','reservation-profile','environment-dataset','zone-lighting-model','control-scenario-model'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','data',file+'.js'),'utf8'),context);
const model=vm.runInContext('controlScenarioModel',context),data=vm.runInContext('environmentDataset',context),artifact=vm.runInContext('reservationArtifact',context);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const records=data.records.filter(r=>r.date==='2026-06-29');
const simulateLegacy=(r,a,input={})=>model.simulateDay(r,a,{leadMinutes:30,...input,hvacPolicy:'ideal'});

// Analytical energy balance: no conductance, and an exponential cooling transient.
near(model.advanceTemperature(24,30,1000,0,{capacityJPerK:60000,conductanceWPerK:0},60),25);
const p={capacityJPerK:100000,conductanceWPerK:100};
near(model.advanceTemperature(24,24,0,0,p,60),24);
near(model.advanceTemperature(30,20,0,0,p,120),model.advanceTemperature(model.advanceTemperature(30,20,0,0,p,60),20,0,0,p,60));

const result=simulateLegacy(records,artifact),zeroLead=simulateLegacy(records,artifact,{leadMinutes:0});
for(const mode of result.modes) {
  assert.equal(mode.trace.length,1440);
  assert.equal(mode.occupiedMinutes,records.filter(r=>r.floorReservationProxy>0).length*30);
  near(mode.energyKwh,mode.hvacKwh+mode.lightingKwh);
  assert.ok(mode.energyKwh>=0);
  assert.ok(mode.temperatureCompliancePct>=0&&mode.temperatureCompliancePct<=100);
  assert.equal(mode.trace[0].people,0);
  assert.ok(mode.trace.every(t=>Number.isFinite(t.temperatureC)&&t.hvacKw>=0&&t.hvacKw<=18.36+1e-8));
  for(let i=0;i<1440;i++) {
    assert.equal(mode.trace[i].people,result.modes[0].trace[i].people);
    assert.equal(mode.trace[i].tubes,result.modes[0].trace[i].tubes);
  }
}
near(zeroLead.modes[1].energyKwh,zeroLead.modes[2].energyKwh);
for(let i=0;i<1440;i++)near(zeroLead.modes[1].trace[i].temperatureC,zeroLead.modes[2].trace[i].temperatureC);
assert.ok(result.modes[2].firstCoolingMinute<result.modes[1].firstCoolingMinute);
assert.ok(result.modes[2].firstArrivalTemperatureC<=result.modes[1].firstArrivalTemperatureC);
near(result.modes[0].lightingKwh,result.modes[2].lightingKwh);

// Changing future demand/weather must not alter any prior action or temperature.
const changed=records.map(r=>({...r}));
for(let slot=13;slot<48;slot++)Object.assign(changed[slot],{floorReservationProxy:314,outdoorTemperatureC:45,southVerticalIrradianceWm2:2000});
const futureChanged=simulateLegacy(changed,artifact);
for(let minute=0;minute<390;minute++)for(let i=0;i<3;i++) {
  const a=result.modes[i].trace[minute],b=futureChanged.modes[i].trace[minute];
  assert.equal(a.enabled,b.enabled);near(a.temperatureC,b.temperatureC);near(a.hvacKw,b.hvacKw);
}
assert.ok(futureChanged.modes.some(m=>m.capacityLimitedMinutes>0));
assert.ok(futureChanged.modes.some(m=>m.temperatureCompliancePct<100));

// A cold space is not silently heated or forced into the desired range.
const cold=records.map(r=>({...r,outdoorTemperatureC:12,southVerticalIrradianceWm2:0,floorReservationProxy:1}));
const coldResult=simulateLegacy(cold,artifact,{initialTemperatureC:20});
assert.ok(coldResult.modes.every(m=>m.hvacKwh===0&&m.belowRangeDegreeMinutes>0&&m.temperatureCompliancePct===0));

// A daytime vacancy can distinguish an ordinary latched schedule from sensing.
const gap=records.map(r=>({...r}));gap[24].floorReservationProxy=0;
const gapResult=simulateLegacy(gap,artifact);
assert.equal(gapResult.modes[0].trace[720].enabled,true);
assert.equal(gapResult.modes[1].trace[720].enabled,false);
const lead=model.leadComparison(records,artifact,{hvacPolicy:'ideal'});
assert.equal(lead.length,3);near(lead[0].energyKwh,zeroLead.modes[1].energyKwh);
const sensitivity=model.sensitivity(records,artifact,{hvacPolicy:'ideal'});
assert.equal(sensitivity.scenarios,9);assert.ok(sensitivity.note.includes('不是'));
assert.throws(()=>model.simulateDay(records.slice(1),artifact));
assert.throws(()=>model.simulateDay([...records].reverse(),artifact));
for(const day of data.daily) {
  const d=simulateLegacy(data.records.filter(r=>r.date===day.date),artifact);
  if(day.date<='2026-06-28')assert.ok(d.predictionEvaluationStatus.includes('训练期回放'));
  else assert.ok(d.predictionEvaluationStatus.includes('训练期外'));
  assert.ok(d.modes.every(m=>Number.isFinite(m.energyKwh)&&Number.isFinite(m.endTemperatureC)));
}
console.log('Historical ideal-model regression passed: heat balance, shared demand, zero-lead equivalence only in legacy policy, future isolation, capacity/cold limits and seven days.');
