'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ctx=vm.createContext({});
const root=__dirname+'/..';for(const n of ['building-inputs','reservation-model','reservation-profile','spatial-occupancy-model','spatial-thermal-model','hvac-response-model','hvac-predictive-model'])vm.runInContext(fs.readFileSync(`${root}/data/${n}.js`,'utf8'),ctx);
const m=vm.runInContext('hvacPredictiveModel',ctx),r=vm.runInContext('hvacResponseModel',ctx),artifact=vm.runInContext('reservationArtifact',ctx),near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const s=m.settings(),weather={date:'2026-06-29',slot:13,outdoorTemperatureC:29,southVerticalIrradianceWm2:100},counts=[0,0,0,0];
const arrival={floorMapping:{coefficient:1},floorWeight:0,floorProfile:Array(48).fill(200),profile:Array(48).fill(200)};
let forbiddenReads=0;for(const key of ['futureWeather','nextRecord','futureActualPeople','records'])Object.defineProperty(weather,key,{get(){forbiddenReads++;throw new Error('Future actual input leak');}});
const pr=m.projection(weather,arrival,415,counts,s);assert.equal(pr.predictedPeople,200);assert.equal(pr.nextBoundaryMinute,420);assert.equal(pr.futureUsedInWindow,true);assert.equal(pr.usesFutureActual,false);assert.equal(pr.weather.outdoorTemperatureC,29);
assert.equal(m.countsAt(pr,299).reduce((a,b)=>a+b),0);assert.equal(m.countsAt(pr,300).reduce((a,b)=>a+b),200);
const onBoundary=m.projection(weather,arrival,390,counts,s);assert.equal(onBoundary.futureUsedInWindow,false);
const fall=m.projection(weather,null,415,counts,s);assert.equal(fall.forecastStatus,'forecast_fallback');assert.equal(fall.predictedPeople,0);
const late=m.projection({...weather,slot:44},arrival,1345,counts,s);assert.equal(late.durationSeconds,300);assert.equal(late.futureUsedInWindow,false);
// Forecast information can change a decision without future observed weather or people.
const pl=r.plant({mixingWPerK:5000}),initial=pl.initial([24,24,24,24]),before=JSON.stringify(initial);
const pred=m.decision(initial,weather,counts,415,arrival,pl,{mixingWPerK:5000});
const hold=m.decision(initial,weather,counts,415,arrival,pl,{mixingWPerK:5000,forecastMode:'persistence'});
assert.equal(JSON.stringify(initial),before);assert.equal(forbiddenReads,0);assert.equal(pred.events.length,4);assert.equal(hold.events.length,0);
assert.notEqual(pred.command.id,hold.command.id);assert.equal(hold.command.id,'off_off');assert.equal(pred.search.isGlobalOptimal,false);assert.ok(pred.best.metrics.energyKwh>=0);
// Replay every command in the chosen plan independently, checking holds and energy.
let state=initial,energy=0,elapsed=0;for(const command of pred.best.sequence){
  assert.ok(m.allowed(state,415+elapsed/60,m.settings({mixingWPerK:5000})).some(a=>a.id===command.id));
  for(let k=0;k<20;k++){const step=pl.step(state,pred.projection.weather,m.countsAt(pred.projection,elapsed),command,15);assert.ok(step.maximumRegionResidualJ<1e-5);state=step.state;energy+=step.hvacKwh;elapsed+=15;}
}
near(energy,pred.best.metrics.energyKwh,1e-10);state.temperaturesC.forEach((t,i)=>near(t,pred.best.state.temperaturesC[i],1e-10));
assert.equal(pred.best.boundaries.length,6);assert.ok(pred.candidates.every(c=>c.sequence.length===6));
// A new start cannot be squeezed into less than its ten-minute permission hold.
assert.ok(m.allowed(pl.initial(),1345,m.settings()).every(a=>a.id==='off_off'));
const used=pl.step(pl.initial([26,26,26,26]),weather,[40,40,40,40],r.actions.find(a=>a.id==='23_23')).state;
assert.ok(m.allowed(used,395,m.settings()).every(a=>a.enabled.every(Boolean)));assert.ok(m.allowed(used,395,m.settings()).every(a=>a.setpointsC.every(t=>t===23)));
// No fabricated room-temperature reset, no saving rate, and full replay energy.
const records=Array.from({length:48},(_,slot)=>({...weather,slot,floorReservationProxy:slot<14?0:80}));
const run=m.runDay(records,artifact,{startMinute:390,endMinute:420,initialTemperatureC:26,beamWidth:4,keepTrace:true});
assert.equal(run.decisions.length,6);assert.equal(run.trace.length,120);assert.equal(run.savingPct,null);assert.equal(run.usesFutureActual,false);assert.equal(run.initialTemperaturesC[0],26);
near(run.hvacKwh,run.trace.reduce((a,t)=>a+t.hvacKwh,0),1e-9);near(run.hvacKwh,run.unitOnMinutes.reduce((a,t)=>a+t,0)*9.18/60,1e-9);assert.ok(run.maxBalanceResidualJ<1e-5);
assert.ok(run.decisions.every(d=>d.simulatedFeedback&&d.best.sequence.length<=6));
assert.throws(()=>m.runDay(records,artifact,{startMinute:390,endMinute:420,feedbackThermalSettings:{commandMinimumSeconds:0}}),/restricted/);
assert.throws(()=>m.settings({beamWidth:1.5}));assert.throws(()=>m.settings({forecastMode:'oracle'}));assert.throws(()=>m.projection(weather,artifact,420,counts,s));
console.log(JSON.stringify({passed:true,futureActualIsolation:true,forecastChangesAction:{predictive:pred.command.id,persistence:hold.command.id},chosenPlanIndependentReplay:true,deviceHolds:true,energyAndThermalBalance:true,simulatedFeedback:true,noSavingClaim:true}));
