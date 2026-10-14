'use strict';
const assert=require('node:assert/strict'),view=require('../data/lighting-hvac-separated-view.js');
const make=(mode,extraLamps=0,extraAc=0)=>{
  const trace=Array.from({length:192},(_,i)=>({minute:390+i*5,people:20,counts:[10,10,0,0],tubesOn:20+(i===31?extraLamps:0),
    zoneLightWatts:[(20+(i===31?extraLamps:0))*18,0,0,0],lightingKwh:(20+(i===31?extraLamps:0))*18/12000,
    hvacKwh:.1+(i===80?extraAc:0),endingC:[24+(i>=31?extraLamps*.001:0),24,24,24],command:'24_24'}));
  return {mode,date:'2026-06-30',trace,lightingKwh:trace.reduce((n,t)=>n+t.lightingKwh,0),hvacKwh:trace.reduce((n,t)=>n+t.hvacKwh,0),
    switches:42,modelTargetCompliancePct:50,fullOnModelTargetCompliancePct:50,lightingServicePass:true,
    occupiedCompliancePct:100,temperaturePass:true,finalTemperaturesC:trace.at(-1).endingC,storedChangeKwhThermal:0};
};
const realtime=view.mode(make('realtime')),predictive=view.mode(make('predictive',3,.025));
assert.equal(realtime.points.length,192);assert.equal(realtime.points[31].time,'09:05');
assert.ok(Math.abs(view.compare(realtime,predictive).lighting.candidateMinusReferenceKwh-3*18/12000)<1e-10);
const linked=view.linkage(realtime,predictive);
assert.equal(linked.sameHighLevelCommands,true);assert.equal(linked.firstLightingDifference.time,'09:05');
assert.equal(linked.firstTemperatureDifference.time,'09:05');assert.equal(linked.firstHvacEnergyDifference.time,'13:10');
assert.equal(linked.lightingDifferentSlots,1);assert.equal(linked.hvacEnergyDifferentSlots,1);
assert.ok(!JSON.stringify(view.compare(realtime,predictive)).includes('totalKwh'));
assert.throws(()=>view.mode({...make('baseline'),lightingKwh:0}),/reconcile/);
console.log('Separated view passed: independent meters, synchronized timeline, coupling chronology, no combined headline.');
