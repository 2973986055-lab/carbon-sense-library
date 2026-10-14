'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const context=vm.createContext({});
for(const name of ['building-inputs','reservation-model','reservation-profile','spatial-occupancy-model','spatial-thermal-model','environment-dataset',
  'hvac-response-model','hvac-predictive-model','hvac-supervisory-model','hvac-comfort-v2-model','hvac-three-mode-v2-model','hvac-forecast-guard-v3-model','lighting-hvac-joint-model'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../data',name+'.js'),'utf8'),context);
const model=vm.runInContext('lightingHvacJointModel',context),response=vm.runInContext('hvacResponseModel',context);
const near=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
assert.equal(model.capacity.reduce((a,b)=>a+b,0),314);
for(const [r,n] of [70,90,70,84].entries())assert.equal(model.capacity.filter((_,i)=>model.region[i]===r).reduce((a,b)=>a+b,0),n);
for(const total of [0,1,100,313,314]){
  const zones=vm.runInContext(`spatialOccupancyModel.allocate(${total},'west')`,context),groups=model.groups(zones);
  assert.equal(groups.reduce((a,b)=>a+b,0),total);
  for(let r=0;r<4;r++)assert.equal(groups.filter((_,i)=>model.region[i]===r).reduce((a,b)=>a+b,0),zones[r]);
}
const full=Array(14).fill(3),zero=Array(14).fill(0);
assert.equal(model.watts(full).reduce((a,b)=>a+b,0),756);
assert.equal(model.watts(zero).reduce((a,b)=>a+b,0),0);
const record={outdoorTemperatureC:30,southVerticalIrradianceWm2:500},counts=[40,50,40,50],command={enabled:[false,false],setpointsC:[24,24]};
const pl=model.coupledPlant({mixingWPerK:5000}),state=pl.initial([24,24,24,24]);
pl.setLighting(model.watts(full));const on=pl.step(state,record,counts,command,15);
pl.setLighting(model.watts(zero));const off=pl.step(state,record,counts,command,15);
near(on.ledger.lightsJ,756*15);near(off.ledger.lightsJ,0);
assert.ok(on.state.temperaturesC.every((v,i)=>v>off.state.temperaturesC[i]));
assert.ok(Math.abs(on.ledger.residualJ)<1e-5&&on.maximumRegionResidualJ<1e-5);
assert.ok(Math.abs(off.ledger.residualJ)<1e-5&&off.maximumRegionResidualJ<1e-5);
const candidate=model.memory(),bright={southVerticalIrradianceWm2:800},dark={southVerticalIrradianceWm2:0};
model.lightingStep(candidate,'realtime',390,bright,[0,0,0,0],[0,0,0,0],null);
const reduced=model.lightingStep(candidate,'realtime',405,bright,[0,0,0,0],[0,0,0,0],null);
assert.ok(reduced.tubesOn<42);
const restored=model.lightingStep(candidate,'realtime',410,dark,[70,90,70,84],[70,90,70,84],bright);
assert.equal(restored.tubesOn,42);assert.equal(restored.servicePass,true);
const forecastMemory=model.memory();
model.lightingStep(forecastMemory,'predictive',390,bright,[0,0,0,0],[70,90,70,84],null);
const guarded=model.lightingStep(forecastMemory,'predictive',405,bright,[0,0,0,0],[70,90,70,84],bright);
assert.ok(guarded.tubesOn>=reduced.tubesOn);
assert.equal(response.settings({}).stepSeconds,15);
console.log('Joint lighting/HVAC passed: 314-seat crosswalk, 756-W conservation, positive lamp heat, thermal balance and causal lighting guards.');
