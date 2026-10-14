'use strict';
// Recompute the six frozen historical scenarios using only files in this repository.
// This script reads evidence and checks hashes; it never writes generated results.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const data=path.join(root,'data');
const frozen=path.join(root,'evidence','joint-replays');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const read=file=>fs.readFileSync(file);
const names=['building-inputs','reservation-model','reservation-profile','spatial-occupancy-model','spatial-thermal-model','environment-dataset',
  'hvac-response-model','hvac-predictive-model','hvac-supervisory-model','hvac-comfort-v2-model','hvac-three-mode-v2-model','hvac-forecast-guard-v3-model','lighting-hvac-joint-model'];
const context=vm.createContext({});
for(const name of names)vm.runInContext(read(path.join(data,name+'.js')).toString('utf8'),context,{filename:name+'.js'});
const joint=vm.runInContext('lightingHvacJointModel',context);
const environment=vm.runInContext('environmentDataset',context);
const building=vm.runInContext('buildingInputs',context);
const artifact=vm.runInContext('reservationArtifact',context);
const equipmentCorrection=JSON.parse(read(path.join(root,'evidence','equipment-provenance-correction.json')));
assert.equal(equipmentCorrection.id,'CARBON-EQUIPMENT-PROVENANCE-01');
assert.equal(equipmentCorrection.frozenSource.path,'data/environment-dataset.js');
assert.equal(sha(read(path.join(root,equipmentCorrection.frozenSource.path))),equipmentCorrection.frozenSource.sha256);
assert.equal(equipmentCorrection.frozenSource.field,'equipment.airConditioners.secondUnitSameRating');
assert.equal(environment.equipment.airConditioners.secondUnitSameRating,equipmentCorrection.frozenSource.originalValue);
assert.equal(equipmentCorrection.currentSource.path,'data/building-inputs.js');
assert.equal(sha(read(path.join(root,equipmentCorrection.currentSource.path))),equipmentCorrection.currentSource.sha256);
assert.equal(building.equipment.hvac.sameSpecificationConfirmed,true);
assert.equal(building.equipment.hvac.count,equipmentCorrection.currentSource.unitCount);
assert.equal(building.equipment.hvac.model,equipmentCorrection.currentSource.modelOnFirstPhotographedLabel);
assert.equal(building.equipment.hvac.inputKwPerUnit,equipmentCorrection.currentSource.ratedInputKwPerUnit);
assert.equal(building.equipment.hvac.coolingKwPerUnit,equipmentCorrection.currentSource.ratedCoolingKwPerUnit);
assert.equal(building.equipment.hvac.photographedLabels,equipmentCorrection.currentSource.photographedLabelCount);
const adapterPath=path.join(data,'lighting-hvac-separated-view.js');
const adapter=require(adapterPath);
const viewManifest=JSON.parse(read(path.join(data,'joint-evidence-manifest.json')));
const spaceManifest=JSON.parse(read(path.join(data,'joint-space-evidence-manifest.json')));
const actionPath=path.join(data,'joint-forecast-action-data.js');
const actionContext={window:{}};
vm.runInNewContext(read(actionPath).toString('utf8'),actionContext,{filename:'joint-forecast-action-data.js'});
const actionEvidence=actionContext.window.CarbonJointForecastActionEvidence;
assert.equal(sha(read(actionPath)),viewManifest.forecastActionDataSha256,'Forecast action supplement hash changed');
assert.equal(actionEvidence.id,'CARBON-JOINT-FORECAST-ACTION-01');
assert.equal(actionEvidence.decisionPointsPerCase,192);
assert.equal(actionEvidence.cases.length,6);
assert.equal(sha(read(adapterPath)),viewManifest.sourceAdapterSha256,'Separated adapter hash changed');
assert.equal(viewManifest.sourceCases.length,6);
assert.equal(spaceManifest.sources.length,6);
const websiteCases=[],spaceCases=[],rows=[];
for(const day of ['29','30'])for(const mixingWPerK of [300,1000,5000]){
  const date=`2026-06-${day}`;
  const records=environment.records.filter(r=>r.date===date);
  assert.equal(records.length,48,`${date}: expected 48 half-hour weather and reservation inputs`);
  const input={mixingWPerK,pattern:'west',stepSeconds:15,keepTrace:true};
  const modes={};
  for(const mode of ['baseline','realtime','predictive']){
    const result=joint.runDay(records,artifact,mode,input);
    assert.equal(result.trace.length,192);
    assert.equal(result.usesFutureActual,false);
    assert.ok(result.maxResidualJ<1e-5);
    assert.ok(Math.abs(result.ledger.lightsJ-result.lightingKwh*3600000)<1e-4);
    modes[mode]=result;
  }
  const pairs={baselineToRealtime:joint.compare(modes.baseline,modes.realtime),
    baselineToPredictive:joint.compare(modes.baseline,modes.predictive),
    realtimeToPredictive:joint.compare(modes.realtime,modes.predictive)};
  const provenance={sourceHashes:Object.fromEntries(names.map(name=>[name,sha(read(path.join(data,name+'.js')))])),
    forecastTrainingDates:artifact.trainingLabels??artifact.trainingDates??null,
    recordDates:records.map(r=>r.date),recordCount:records.length,
    interpretation:'Historical, repeatedly inspected June 29–30 replay; no indoor measurements or verified zone/lamp map. Raw nominal differences are not qualified savings.'};
  const raw={id:'CARBON-JOINT-LIGHT-HVAC-01',date,mixingWPerK,input,provenance,
    summary:Object.fromEntries(Object.entries(modes).map(([key,r])=>[key,{hvacKwh:r.hvacKwh,lightingKwh:r.lightingKwh,totalKwh:r.totalKwh,
      occupiedCompliancePct:r.occupiedCompliancePct,temperaturePass:r.temperaturePass,modelTargetCompliancePct:r.modelTargetCompliancePct,
      fullOnModelTargetCompliancePct:r.fullOnModelTargetCompliancePct,lightingServicePass:r.lightingServicePass,switches:r.switches,
      finalTemperaturesC:r.finalTemperaturesC,storedChangeKwhThermal:r.storedChangeKwhThermal,maxResidualJ:r.maxResidualJ}])),pairs,modes};
  const rawText=JSON.stringify(raw),rawFile=`${date}_mix${mixingWPerK}_joint.json`;
  const expected=viewManifest.sourceCases.find(c=>c.date===date&&c.mixingWPerK===mixingWPerK);
  const expectedSpace=spaceManifest.sources.find(c=>c.date===date&&c.mixingWPerK===mixingWPerK);
  assert.ok(expected&&expectedSpace);
  assert.equal(expected.replaySource,rawFile);
  assert.equal(expectedSpace.file,rawFile);
  assert.equal(sha(rawText),expected.replaySha256);
  assert.equal(sha(rawText),expectedSpace.sha256);
  const frozenBytes=read(path.join(frozen,rawFile));
  assert.equal(sha(frozenBytes),expected.replaySha256,`${rawFile}: frozen hash differs from manifest`);
  assert.ok(frozenBytes.equals(Buffer.from(rawText)),`${rawFile}: frozen replay differs from recomputation`);
  const action=actionEvidence.cases.find(c=>c.date===date&&c.mixingWPerK===mixingWPerK);
  assert.ok(action,`${rawFile}: missing forecast action audit`);
  assert.equal(action.replaySource,rawFile);
  assert.equal(action.replaySha256,sha(rawText));
  const guards=modes.predictive.trace.map(p=>p.guard).filter(Boolean);
  const selected=guards.filter(g=>g.reason==='forecast_selected');
  assert.equal(action.forecastSelectedCount,selected.length);
  assert.equal(action.sameStateCommandChanges,selected.filter(g=>g.predictiveCommand!==g.realtimeCommand).length);
  assert.equal(action.crossModeCommandDifferences,modes.realtime.trace.filter((p,i)=>p.command!==modes.predictive.trace[i].command).length);
  const converted=adapter.caseView(raw);
  const separate={...converted,provenance:{sourceReplay:rawFile,sourceReplaySha256:sha(rawText),adapterSha256:sha(read(adapterPath))}};
  const separateText=JSON.stringify(separate);
  assert.ok(!separateText.includes('totalKwh')&&!separateText.includes('rawTotalDifference'));
  assert.equal(expected.source,`${date}_mix${mixingWPerK}_separate.json`);
  assert.equal(sha(separateText),expected.sha256,`${date}/${mixingWPerK}: separated output hash mismatch`);
  const compactModes=Object.fromEntries(['baseline','realtime','predictive'].map(key=>{
    const mode=separate.modes[key];
    return [key,{lighting:mode.lighting,hvac:mode.hvac,
      points:mode.points.map(p=>({minute:p.minute,time:p.time,tubesOn:p.tubesOn,lightingWatts:p.lightingWatts,
        hvacAverageKw:p.hvacAverageKw,occupiedMaxC:p.occupiedMaxC,hvacCommand:p.hvacCommand}))}];
  }));
  websiteCases.push({date,mixingWPerK,modes:compactModes,linkage:separate.realtimeToPredictiveLinkage,
    comparisons:separate.comparisons,scope:separate.labels.scope});
  spaceCases.push({date,mixingWPerK,modes:Object.fromEntries(['baseline','realtime','predictive'].map(key=>[key,
    raw.modes[key].trace.map(p=>[p.counts,p.zoneLightWatts,p.endingC])]))});
  rows.push({date,mixingWPerK,replaySha256:sha(rawText),separateSha256:sha(separateText)});
}
const website={id:'CARBON-JOINT-SPLIT-WEBSITE-01',version:'20261014-joint-split-local',
  note:'Precomputed historical scenarios. Lighting and HVAC electricity remain separate; lamp heat is coupled into the four-region HVAC replay.',cases:websiteCases};
const websiteScript=`window.CarbonJointEvidence=${JSON.stringify(website)};\n`;
assert.ok(!websiteScript.includes('totalKwh')&&!websiteScript.includes('rawTotalDifference'));
assert.equal(sha(websiteScript),viewManifest.websiteDataSha256);
assert.ok(read(path.join(data,'joint-evidence-data.js')).equals(Buffer.from(websiteScript)),'Website split data changed');
const space={version:'20261014-space-sync-local',zoneOrder:['south-west','south-east','north-west','north-east'],
  pointMeaning:['fourZonePeopleProxy','fourZoneLightingWatts','fourZoneEndingTemperatureC'],cases:spaceCases};
const spaceScript='window.CarbonJointSpaceEvidence='+JSON.stringify(space)+';\n';
assert.equal(sha(spaceScript),spaceManifest.dataSha256);
assert.ok(read(path.join(data,'joint-space-evidence-data.js')).equals(Buffer.from(spaceScript)),'Website spatial data changed');
console.log(JSON.stringify({passed:true,cases:rows,websiteSha256:sha(websiteScript),spaceSha256:sha(spaceScript)},null,2));
