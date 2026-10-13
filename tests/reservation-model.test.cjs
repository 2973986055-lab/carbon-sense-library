'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),context=vm.createContext({});
for(const file of ['reservation-model.js','reservation-profile.js','environment-dataset.js'])
  vm.runInContext(fs.readFileSync(path.join(root,'data',file),'utf8'),context);
const model=vm.runInContext('reservationModel',context);
const artifact=vm.runInContext('reservationArtifact',context);
const environment=vm.runInContext('environmentDataset',context);
const source=JSON.parse(fs.readFileSync(path.join(root,'data/reservation-source.json'),'utf8'));
const near=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const training=source.days.slice(0,5),heldout=source.days.slice(5);
assert.equal(source.days.length,7);
assert.equal(source.days.flatMap(d=>d.counts).length,336);
assert.equal(training.map(d=>d.date).join(','),'2026-06-24,2026-06-25,2026-06-26,2026-06-27,2026-06-28');
assert.equal(heldout.map(d=>d.date).join(','),'2026-06-29,2026-06-30');
assert.equal(artifact.trainingCount,240);
assert.equal(artifact.testCount,96);
assert.equal(artifact.version,2);
assert.equal(artifact.sourceYear,2026);
assert.equal(artifact.floorSeats,314);
assert.equal(artifact.referencePeak,1388);
assert.equal(artifact.weight,1);
assert.equal(artifact.floorWeight,.5);
assert.equal(artifact.validation[2].active.count,64);
near(artifact.validation[2].active.mae,14.95);
near(artifact.floorValidation[2].active.mae,4.677087738855278);
assert.ok(artifact.floorSelection.folds.every(f=>f.targetDate<='2026-06-28'&&f.trainingDates.every(d=>d<f.targetDate)));
assert.equal(artifact.floorMapping.trainingDates.join(','),training.map(d=>d.date).join(','));
assert.equal(environment.peopleValidationSummary.activeTargets,64);
near(environment.peopleValidationSummary.mae,artifact.validation[2].active.mae);
assert.equal(environment.daily.filter(d=>d.role==='training').length,5);
assert.equal(environment.daily.filter(d=>d.role==='validation').length,2);

const rebuilt=model.fitFrozen(training,314);
near(rebuilt.floorMapping.coefficient,artifact.floorMapping.coefficient);
near(rebuilt.floorWeight,artifact.floorWeight);
near(rebuilt.weight,artifact.weight);
for(let slot=0;slot<48;slot++) {
  near(rebuilt.profile[slot],artifact.profile[slot]);
  near(rebuilt.floorProfile[slot],artifact.floorProfile[slot]);
}
const trainingChanged=training.map(d=>({...d}));
trainingChanged[0].floorRegisteredHours+=25;
const changed=model.fitFrozen(trainingChanged,314);
assert.notEqual(changed.floorMapping.coefficient,artifact.floorMapping.coefficient);
for(let slot=0;slot<48;slot++) near(changed.profile[slot],artifact.profile[slot]);

// A held-out day's FINAL duration can change the scoring target but must not
// change the frozen model, its current input, or its prediction.
const referenceDay=heldout[0],modifiedDay={...referenceDay,floorRegisteredHours:referenceDay.floorRegisteredHours-100};
const scored=model.scoreRegistered(artifact,referenceDay,'adjusted');
const rescored=model.scoreRegistered(artifact,modifiedDay,'adjusted');
near(scored.points[30].current,rescored.points[30].current);
near(scored.points[30].predicted,rescored.points[30].predicted);
assert.notEqual(scored.points[30].actual,rescored.points[30].actual);
for(const d of heldout){
  const scoredFull=model.score(artifact,d.counts,'adjusted',artifact.weight);
  const scoredFloor=model.scoreRegistered(artifact,d,'adjusted');
  assert.equal(scoredFull.active.count,32);
  assert.equal(scoredFloor.active.count,32);
  assert.ok(scoredFloor.rollingPredictedRegisteredHours>0);
  for(const p of scoredFloor.points)assert.ok(p.predicted>=0&&p.predicted<=314);
}
for(const record of environment.records){
  const expected=model.registeredProxy(artifact.floorMapping,record.libraryReservations);
  near(record.floorRegisteredProxyUnrounded,expected);
  assert.equal(record.floorReservationProxy,Math.round(expected));
  assert.equal(record.floorActualAttendance,null);
}
const before=model.transfer(artifact,32,300);
assert.equal(before.targetSlot,33);
assert.ok(before.people>=0&&before.people<=314);
assert.throws(()=>model.transfer(artifact,47,300));
assert.throws(()=>model.transfer(artifact,32,315));
assert.throws(()=>model.fitRegisteredMapping([training[0],training[0]],314));
assert.throws(()=>model.fitRegisteredMapping([{...training[0],floorRegisteredHours:999999}],314));
const current=model.registeredProxy(artifact.floorMapping,referenceDay.counts[30]);
const forecast=model.transfer(artifact,30,current).people;
const changedFuture={...referenceDay,counts:[...referenceDay.counts]};
changedFuture.counts[31]+=200;
assert.equal(model.transfer(artifact,30,model.registeredProxy(artifact.floorMapping,changedFuture.counts[30])).people,forecast);

const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
assert.equal(new Set(ids).size,ids.length);
for(const match of html.matchAll(/getElementById\('([^']+)'\)/g))
  assert.ok(ids.includes(match[1]),'Missing ID '+match[1]);
for(const filename of ['reservation-profile.js','reservation-source.json'])
  assert.ok(!fs.readFileSync(path.join(root,'data',filename),'utf8').includes('C:/Users/'));
console.log(JSON.stringify({passed:true,trainingDays:5,validationDays:2,
  fullMae:artifact.validation[2].active.mae,
  floorRetrospectiveScenarioMae:artifact.floorValidation[2].active.mae}));
