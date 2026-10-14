'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ctx=vm.createContext({});
const root=__dirname+'/..';for(const n of ['building-inputs','spatial-occupancy-model','spatial-thermal-model','hvac-response-model'])vm.runInContext(fs.readFileSync(`${root}/data/${n}.js`,'utf8'),ctx);
const m=vm.runInContext('hvacResponseModel',ctx),th=vm.runInContext('spatialThermalModel',ctx),near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`),sum=a=>a.reduce((s,x)=>s+x,0);
const record={outdoorTemperatureC:32,southVerticalIrradianceWm2:150},counts=[40,40,40,40],off=m.actions.find(a=>a.id==='off_off'),both=m.actions.find(a=>a.id==='23_23'),west=m.actions.find(a=>a.id==='23_off');
let cases=0;
for(const coverage of Object.keys(m.coverageProfiles))for(const sensor of Object.keys(m.sensorProfiles))for(const responseSeconds of [0,30,120]){
  const p=m.plant({coverage,sensor,responseSeconds});const old=p.initial([26,26,26,26]),before=JSON.stringify(old);const r=p.step(old,record,counts,both);
  assert.equal(JSON.stringify(old),before);cases++;assert.ok(r.maximumRegionResidualJ<1e-5);near(r.ledger.residualJ,0,1e-5);near(r.ledger.mixingJ,0,1e-8);
  p.parameters.coolingShares.forEach(ws=>{near(sum(ws),1);assert.ok(ws.every(w=>w>=0));});p.sensorWeights.forEach(ws=>near(sum(ws),1));
  near(sum(r.unitCoolingW),sum(r.zoneCoolingW));assert.ok(r.unitCoolingW.every(q=>q>=0&&q<=21000));near(r.hvacKwh,18.36*15/3600);
}
const p=m.plant(),start=p.initial([26,26,26,26]);
for(const [action,legacy] of [[off,'off'],[west,'west'],[both,'both']]){
  const r=p.step(start,record,counts,action),expected=th.step(start.temperaturesC,record,counts,legacy,legacy==='off'?0:1,p.parameters,15);
  r.state.temperaturesC.forEach((t,i)=>near(t,expected.temperaturesC[i],1e-10));
}
// Same room state, different assumed sensor location: no hidden all-zone oracle.
const c=m.actions.find(a=>a.id==='24_24'),local=m.plant({sensor:'localSouth'}),segment=m.plant({sensor:'ownSegment'}),temps=[23.5,23.5,26,26];
assert.ok(local.step(local.initial(temps),record,counts,c).state.units.every(u=>!u.on));assert.ok(segment.step(segment.initial(temps),record,counts,c).state.units.every(u=>u.on));
// A device setpoint does not force the room temperature to that value.
assert.ok(p.step(start,record,counts,both).state.temperaturesC.some(t=>t>25));
// Relay hysteresis and compressor dwell independent from permission holds.
let st=p.step(start,record,counts,both).state;st={...st,temperaturesC:[22,22,22,22]};assert.ok(p.step(st,record,counts,both).state.units.every(u=>u.on));
assert.ok(p.step({...st,elapsedSeconds:180},record,counts,both).state.units.every(u=>!u.on));
assert.throws(()=>p.step(st,record,counts,off),/Permission dwell/);
assert.throws(()=>p.step(st,record,counts,c),/Setpoint dwell/);
assert.throws(()=>p.step({...st,elapsedSeconds:600,units:st.units.map(u=>({...u,lastCompressorChange:590}))},record,counts,off),/Compressor dwell/);
const later=p.step({...st,elapsedSeconds:600},record,counts,off);assert.ok(later.state.units.every(u=>!u.on));near(later.hvacKwh,0);near(sum(later.unitCoolingW),0);
// Ramp integration is analytic, with neither free cooling after OFF nor instant output.
const ramp=m.plant({responseSeconds:120}),r=ramp.step(ramp.initial([26,26,26,26]),record,counts,both,15);near(r.meanFractions[0],1-120/15*(1-Math.exp(-15/120)),1e-12);
// Mirror east/west with mirrored initial states and people.
const mirror=a=>[a[1],a[0],a[3],a[2]],input=[26,25,24,23],n=[40,30,20,10];
const a=p.step(p.initial(input),record,n,west),b=p.step(p.initial(mirror(input)),record,mirror(n),m.actions.find(x=>x.id==='off_23'));
a.state.temperaturesC.forEach((t,i)=>near(t,mirror(b.state.temperaturesC)[i],1e-10));
const sim=m.simulate([{record,counts,seconds:3600}],{},both,[24,24,24,24]);near(sim.hvacKwh,sum(sim.unitOnMinutes)*9.18/60,1e-9);assert.equal(sim.trace.length,240);assert.ok(sim.maximumOccupiedViolationC>0);assert.equal(sim.isPredictiveControl,false);
for(const args of [{coverage:'invented'},{sensor:'unknown'},{responseSeconds:-1}])assert.throws(()=>m.plant(args));
assert.throws(()=>p.step(start,record,[315,0,0,0],both));assert.throws(()=>p.step(start,record,counts,{enabled:[true,true],setpointsC:[23.6,24]}));
console.log(JSON.stringify({passed:true,responseBalanceCases:cases,legacyIntegratorAgreement:true,sensorEffect:true,commandNotTemperature:true,dwellAndRamp:true,eastWestSymmetry:true,energyAccounted:true}));
