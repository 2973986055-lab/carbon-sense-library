'use strict';
// Causal, model-only terminal-state guard against an online realtime shadow.
// Experimental ablation: it does not change the frozen six replays or site.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(file);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const artifactPath=path.join(root,'evidence','forecast-terminal-guard-candidate.json');
const sourceBytes=read(path.join(root,'evidence','forecast-fixed-light-ablation.json'));
const reference=JSON.parse(sourceBytes);
assert.equal(reference.id,'CARBON-FIXED-LIGHT-FORECAST-ABLATION-01');
const names=['building-inputs','reservation-model','reservation-profile','spatial-occupancy-model','spatial-thermal-model','environment-dataset',
  'hvac-response-model','hvac-predictive-model','hvac-supervisory-model','hvac-comfort-v2-model','hvac-three-mode-v2-model','hvac-forecast-guard-v3-model','lighting-hvac-joint-model'];
const context=vm.createContext({});
for(const name of names){
  const bytes=read(path.join(root,'data',`${name}.js`));
  assert.equal(sha(bytes),reference.modelSourceSha256[name],`Model source changed: ${name}`);
  vm.runInContext(bytes.toString('utf8'),context,{filename:`${name}.js`});
}
const get=expression=>vm.runInContext(expression,context);
const joint=get('lightingHvacJointModel'),environment=get('environmentDataset'),artifact=get('reservationArtifact');
const spatial=get('spatialOccupancyModel'),guard=get('hvacForecastGuardV3Model'),comfort=get('hvacComfortV2Model');
const predictive=get('hvacPredictiveModel'),supervisory=get('hvacSupervisoryModel');
const near=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-8,`${label}: ${a} != ${b}`);
const maxDifference=(a,b)=>Math.max(...a.map((value,i)=>Math.abs(value-b[i])));
function addMetrics(total,block){
  for(const key of ['energyKwh','hotDegreeMinutes','coldDegreeMinutes','occupiedDegreeMinutes','emptyDegreeMinutes',
    'occupiedZoneMinutes','withinZoneMinutes','emptyZoneMinutes','withinEmptyZoneMinutes'])total[key]+=block[key];
  for(const key of ['maximumOccupiedViolationC','maximumEmptyViolationC'])total[key]=Math.max(total[key],block[key]);
}
function block(plant,state,record,counts,command,s){
  const metrics=comfort.metrics();let current=state,maxResidualJ=0;
  for(let elapsed=0;elapsed<300-1e-8;){
    const dt=Math.min(plant.settings.stepSeconds,300-elapsed);
    const next=plant.step(current,record,counts,command,dt);
    comfort.observe(metrics,current.temperaturesC,next.state.temperaturesC,counts,dt,s);
    metrics.energyKwh+=next.hvacKwh;
    maxResidualJ=Math.max(maxResidualJ,next.maximumRegionResidualJ,Math.abs(next.ledger.residualJ));
    current=next.state;elapsed+=dt;
  }
  return {state:current,metrics,maxResidualJ,commandId:command.id};
}
function runCase(source,stepSeconds=15){
  const records=environment.records.filter(r=>r.date===source.date),s=guard.settings({mixingWPerK:source.mixingWPerK,pattern:'west',stepSeconds});
  assert.equal(records.length,48);
  const shadowPlant=joint.coupledPlant(s),candidatePlant=joint.coupledPlant(s),lampMemory=joint.memory();
  let shadow=shadowPlant.initial(Array(4).fill(s.initialTemperatureC));
  let candidate=candidatePlant.initial(Array(4).fill(s.initialTemperatureC));
  let supervision=supervisory.memory(),shadowMetrics=comfort.metrics(),candidateMetrics=comfort.metrics();
  const shadowCommands=[],candidateCommands=[],lights=[];
  let overrideCount=0,forecastSelectedCount=0,maxResidualJ=0,maximumEnvelopeOverflowC=0;
  for(let minute=s.startMinute;minute<s.endMinute;minute+=5){
    const record=records[Math.floor(minute/30)],previous=record.slot?records[record.slot-1]:null;
    const counts=spatial.allocate(record.floorReservationProxy,s.pattern);
    supervision=supervisory.observeSlot(supervision,record.slot,counts);
    const lighting=joint.lightingStep(lampMemory,'baseline',minute,record,counts,counts,previous,s);
    assert.equal(lighting.tubesOn,42);
    shadowPlant.setLighting(lighting.zoneWatts);candidatePlant.setLighting(lighting.zoneWatts);
    lights.push(lighting.zoneWatts);
    const shadowCommand=comfort.decision(shadow,record,counts,minute,artifact,shadowPlant,supervision,{...s,forecastMode:'persistence'}).command;
    const shadowNext=block(shadowPlant,shadow,record,counts,shadowCommand,s);
    shadow=shadowNext.state;addMetrics(shadowMetrics,shadowNext.metrics);shadowCommands.push(shadowCommand.id);
    maxResidualJ=Math.max(maxResidualJ,shadowNext.maxResidualJ);

    const forecast=guard.decision(candidate,record,counts,minute,artifact,candidatePlant,supervision,s);
    assert.equal(forecast.forecastGuard.usesFutureActual,false);
    if(forecast.forecastGuard.reason==='forecast_selected')forecastSelectedCount++;
    const proposed=block(candidatePlant,candidate,record,counts,forecast.command,s);
    // Published schedule and fixed band are available from the start of the day.
    // Only the observed current slot drives this one-block shadow projection.
    const envelopeC=.05+1.45*(s.endMinute-(minute+5))/(s.endMinute-s.startMinute);
    let selected=proposed;
    if(maxDifference(proposed.state.temperaturesC,shadow.temperaturesC)>envelopeC+1e-9){
      const legal=supervisory.legal(candidate,minute,s);
      assert.ok(legal.some(action=>action.id===forecast.command.id));
      const options=legal.map(action=>{
        const command=predictive.commandFor(action,candidate);
        const outcome=command.id===forecast.command.id?proposed:block(candidatePlant,candidate,record,counts,command,s);
        const deviationC=maxDifference(outcome.state.temperaturesC,shadow.temperaturesC);
        return {outcome,deviationC,overflowC:Math.max(0,deviationC-envelopeC),
          servicePass:comfort.isFeasible(outcome.metrics),isForecast:command.id===forecast.command.id};
      });
      options.sort((a,b)=>Number(b.servicePass)-Number(a.servicePass)||a.overflowC-b.overflowC||
        a.deviationC-b.deviationC||a.outcome.metrics.energyKwh-b.outcome.metrics.energyKwh||
        Number(b.isForecast)-Number(a.isForecast)||a.outcome.commandId.localeCompare(b.outcome.commandId));
      selected=options[0].outcome;
      if(selected.commandId!==forecast.command.id)overrideCount++;
      maxResidualJ=Math.max(maxResidualJ,...options.map(option=>option.outcome.maxResidualJ));
    }
    candidate=selected.state;addMetrics(candidateMetrics,selected.metrics);candidateCommands.push(selected.commandId);
    maxResidualJ=Math.max(maxResidualJ,selected.maxResidualJ);
    maximumEnvelopeOverflowC=Math.max(maximumEnvelopeOverflowC,
      maxDifference(candidate.temperaturesC,shadow.temperaturesC)-envelopeC);
  }
  assert.ok(maxResidualJ<1e-5);
  const lightScheduleSha256=sha(JSON.stringify(lights));
  assert.equal(lightScheduleSha256,source.modes.realtime.lightScheduleSha256);
  if(stepSeconds===15){
    assert.equal(sha(JSON.stringify(shadowCommands)),source.modes.realtime.commandTraceSha256);
    near(shadowMetrics.energyKwh,source.modes.realtime.hvacKwh,'Realtime shadow HVAC');
    source.modes.realtime.finalTemperaturesC.forEach((temperature,i)=>near(shadow.temperaturesC[i],temperature,`Realtime shadow zone ${i}`));
  }
  const terminalDifferenceC=maxDifference(candidate.temperaturesC,shadow.temperaturesC);
  const bothTemperaturePass=comfort.isFeasible(shadowMetrics)&&comfort.isFeasible(candidateMetrics);
  return {date:source.date,mixingWPerK:source.mixingWPerK,
    referenceAblationCase:{realtimeHvacKwh:source.modes.realtime.hvacKwh,
      originalPredictiveHvacKwh:source.modes.predictive.hvacKwh,
      originalPredictiveTerminalDifferenceC:source.predictiveVsRealtime.terminalDifferenceC},
    shadow:{hvacKwh:shadowMetrics.energyKwh,temperaturePass:comfort.isFeasible(shadowMetrics),
      occupiedCompliancePct:100*shadowMetrics.withinZoneMinutes/shadowMetrics.occupiedZoneMinutes,
      finalTemperaturesC:[...shadow.temperaturesC]},
    terminalGuardCandidate:{hvacKwh:candidateMetrics.energyKwh,temperaturePass:comfort.isFeasible(candidateMetrics),
      occupiedCompliancePct:100*candidateMetrics.withinZoneMinutes/candidateMetrics.occupiedZoneMinutes,
      finalTemperaturesC:[...candidate.temperaturesC],forecastSelectedCount,overrideCount,
      commandTraceSha256:sha(JSON.stringify(candidateCommands))},
    comparison:{nominalHvacDifferenceCandidateMinusShadowKwh:candidateMetrics.energyKwh-shadowMetrics.energyKwh,
      terminalDifferenceC,bothTemperaturePass,temperatureComparable:bothTemperaturePass&&terminalDifferenceC<=.05,
      maximumEnvelopeOverflowC:Math.max(0,maximumEnvelopeOverflowC),qualifiedSavingPct:null},
    lightScheduleSha256,maxResidualJ};
}
if(process.argv.includes('--sensitivity')||process.argv.includes('--write-sensitivity')){
  const source=reference.cases.find(c=>c.date==='2026-06-29'&&c.mixingWPerK===1000);
  assert.ok(source);
  const rows=[5,15,60].map(stepSeconds=>({stepSeconds,...runCase(source,stepSeconds)}));
  const result={id:'CARBON-FORECAST-TERMINAL-GUARD-STEP-SENSITIVITY-01',
    sourceFixedLightAblationSha256:sha(sourceBytes),
    scope:'June 29, 1000 W/K; same causal terminal-guard rule at 5, 15 and 60-second plant integration steps.',
    status:'Exploratory numerical sensitivity, not site validation or an optimized saving claim.',rows};
  const output=JSON.stringify(result,null,2)+'\n';
  const file=path.join(root,'evidence','forecast-terminal-guard-step-sensitivity.json');
  if(process.argv.includes('--write-sensitivity'))fs.writeFileSync(file,output,{flag:'wx'});
  else assert.ok(read(file).equals(Buffer.from(output)),'Frozen step sensitivity differs from recomputation');
  console.log(JSON.stringify({passed:true,rows:rows.map(row=>({stepSeconds:row.stepSeconds,
    nominalHvacDifferenceKwh:row.comparison.nominalHvacDifferenceCandidateMinusShadowKwh,
    terminalDifferenceC:row.comparison.terminalDifferenceC,
    temperatureComparable:row.comparison.temperatureComparable})),artifactSha256:sha(output)},null,2));
  process.exit(0);
}
const cases=reference.cases.map(c=>runCase(c));
const result={id:'CARBON-FORECAST-TERMINAL-GUARD-CANDIDATE-01',version:'20261014-local',
  sourceFixedLightAblationSha256:sha(sourceBytes),
  rule:'Run an online realtime shadow from the same observed current slot. Use the guarded frozen-forecast action unless its one-block modeled endpoint exceeds a linearly shrinking 1.5-to-0.05 C per-zone shadow envelope; then choose among device-legal actions by one-block service, envelope overflow, deviation and nominal energy.',
  initialAndFinalEnvelopeC:[1.5,.05],usesFutureActual:false,
  status:'experimental uncalibrated model candidate; no deployment or site-saving claim',
  limitations:['The realtime shadow is a model counterfactual, not a measured indoor state.',
    'One-block choices cannot guarantee a feasible end temperature or equal final device state.',
    'June 29–30 have been repeatedly inspected during development and are not untouched validation.',
    'Full-on lighting does not meet the 300 lx model target for every proxy occupant.'],cases};
const output=JSON.stringify(result,null,2)+'\n';
if(process.argv.includes('--write')){
  fs.writeFileSync(artifactPath,output,{flag:'wx'});
  console.log(`Created ${artifactPath}`);
}else{
  assert.ok(read(artifactPath).equals(Buffer.from(output)),'Frozen terminal-guard candidate differs from recomputation');
  console.log(JSON.stringify({passed:true,cases:cases.map(c=>({date:c.date,mixingWPerK:c.mixingWPerK,
    hvacDifferenceKwh:c.comparison.nominalHvacDifferenceCandidateMinusShadowKwh,
    terminalDifferenceC:c.comparison.terminalDifferenceC,
    temperatureComparable:c.comparison.temperatureComparable,
    overrideCount:c.terminalGuardCandidate.overrideCount})),artifactSha256:sha(output)},null,2));
}
