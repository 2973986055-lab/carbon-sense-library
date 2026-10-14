'use strict';
// Fixed-lighting counterfactual: only the HVAC forecast policy changes.
// Default mode verifies a frozen local artifact; --write creates it once.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const artifactPath=path.join(root,'evidence','forecast-fixed-light-ablation.json');
const names=['building-inputs','reservation-model','reservation-profile','spatial-occupancy-model','spatial-thermal-model','environment-dataset',
  'hvac-response-model','hvac-predictive-model','hvac-supervisory-model','hvac-comfort-v2-model','hvac-three-mode-v2-model','hvac-forecast-guard-v3-model','lighting-hvac-joint-model'];
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const read=file=>fs.readFileSync(file);
const context=vm.createContext({});
for(const name of names)vm.runInContext(read(path.join(root,'data',name+'.js')).toString('utf8'),context,{filename:name+'.js'});
const get=expression=>vm.runInContext(expression,context);
const joint=get('lightingHvacJointModel'),environment=get('environmentDataset'),artifact=get('reservationArtifact');
const spatial=get('spatialOccupancyModel'),guard=get('hvacForecastGuardV3Model'),comfort=get('hvacComfortV2Model');
const predictive=get('hvacPredictiveModel'),supervisory=get('hvacSupervisoryModel');
const sum=values=>values.reduce((n,v)=>n+v,0);
const near=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-8,`${label}: ${a} != ${b}`);

function simulate(records,mode,mixingWPerK){
  const input={mixingWPerK,pattern:'west',stepSeconds:15};
  const s=guard.settings(input),plant=joint.coupledPlant(s),lampMemory=joint.memory();
  let state=plant.initial(Array(4).fill(s.initialTemperatureC));
  let supervision=supervisory.memory();
  const metrics=comfort.metrics(),commands=[],lightSchedule=[];
  let lightingKwh=0,maxResidualJ=0,forecastSelectedCount=0,sameStateCommandChanges=0;
  for(let minute=s.startMinute;minute<s.endMinute;minute+=5){
    const record=records[Math.floor(minute/30)],previous=record.slot>0?records[record.slot-1]:null;
    const counts=spatial.allocate(record.floorReservationProxy,s.pattern);
    supervision=supervisory.observeSlot(supervision,record.slot,counts);
    const light=joint.lightingStep(lampMemory,'baseline',minute,record,counts,counts,previous,input);
    assert.equal(light.tubesOn,42);
    plant.setLighting(light.zoneWatts);
    lightSchedule.push(light.zoneWatts);
    lightingKwh+=light.tubesOn*18*5/60000;
    let command;
    if(mode==='baseline'){
      const id=sum(counts)>0?'24_24':'off_off';
      const old=state.units.map(u=>u.enabled?u.setpointC:'off').join('_');
      const allowed=predictive.allowed(state,minute,s);
      command=predictive.commandFor(allowed.find(a=>a.id===id)||allowed.find(a=>a.id===old),state);
    }else if(mode==='realtime'){
      command=comfort.decision(state,record,counts,minute,artifact,plant,supervision,{...s,forecastMode:'persistence'}).command;
    }else if(mode==='predictive'){
      const d=guard.decision(state,record,counts,minute,artifact,plant,supervision,s);
      command=d.command;
      assert.equal(d.forecastGuard.usesFutureActual,false);
      if(d.forecastGuard.reason==='forecast_selected'){
        forecastSelectedCount++;
        if(d.forecastGuard.predictiveCommand!==d.forecastGuard.realtimeCommand)sameStateCommandChanges++;
      }
    }else throw Error('Unknown mode');
    commands.push(command.id);
    for(let elapsed=0;elapsed<300-1e-8;){
      const dt=Math.min(plant.settings.stepSeconds,300-elapsed);
      const next=plant.step(state,record,counts,command,dt);
      comfort.observe(metrics,state.temperaturesC,next.state.temperaturesC,counts,dt,s);
      metrics.energyKwh+=next.hvacKwh;
      maxResidualJ=Math.max(maxResidualJ,next.maximumRegionResidualJ,Math.abs(next.ledger.residualJ));
      state=next.state;elapsed+=dt;
    }
  }
  assert.equal(commands.length,192);
  assert.ok(maxResidualJ<1e-5);
  return {mode,hvacKwh:metrics.energyKwh,lightingKwh,
    occupiedCompliancePct:metrics.occupiedZoneMinutes?100*metrics.withinZoneMinutes/metrics.occupiedZoneMinutes:null,
    temperaturePass:comfort.isFeasible(metrics),maximumOccupiedViolationC:metrics.maximumOccupiedViolationC,
    maximumEmptyViolationC:metrics.maximumEmptyViolationC,finalTemperaturesC:[...state.temperaturesC],
    lightScheduleSha256:sha(JSON.stringify(lightSchedule)),commandTraceSha256:sha(JSON.stringify(commands)),
    forecastSelectedCount,sameStateCommandChanges,maxResidualJ,commands};
}

const cases=[];
for(const date of ['2026-06-29','2026-06-30'])for(const mixingWPerK of [300,1000,5000]){
  const records=environment.records.filter(r=>r.date===date);
  assert.equal(records.length,48);
  const modes=Object.fromEntries(['baseline','realtime','predictive'].map(mode=>[mode,simulate(records,mode,mixingWPerK)]));
  const replayFile=`${date}_mix${mixingWPerK}_joint.json`;
  const frozenBytes=read(path.join(root,'evidence','joint-replays',replayFile));
  const frozen=JSON.parse(frozenBytes);
  near(modes.baseline.hvacKwh,frozen.modes.baseline.hvacKwh,`${date}/${mixingWPerK} baseline HVAC`);
  near(modes.baseline.lightingKwh,frozen.modes.baseline.lightingKwh,`${date}/${mixingWPerK} baseline lighting`);
  assert.ok(modes.baseline.finalTemperaturesC.every((t,i)=>Math.abs(t-frozen.modes.baseline.finalTemperaturesC[i])<1e-8));
  assert.equal(modes.baseline.lightScheduleSha256,modes.realtime.lightScheduleSha256);
  assert.equal(modes.baseline.lightScheduleSha256,modes.predictive.lightScheduleSha256);
  const terminalDifferenceC=Math.max(...modes.realtime.finalTemperaturesC.map((t,i)=>Math.abs(t-modes.predictive.finalTemperaturesC[i])));
  const temperatureComparable=modes.realtime.temperaturePass&&modes.predictive.temperaturePass&&terminalDifferenceC<=.05;
  const commandDifferenceSlots=modes.realtime.commands.filter((command,i)=>command!==modes.predictive.commands[i]).length;
  cases.push({date,mixingWPerK,sourceReplay:replayFile,sourceReplaySha256:sha(frozenBytes),
    modes:Object.fromEntries(Object.entries(modes).map(([key,value])=>[key,(({
      commands,...summary})=>summary)(value)])),
    predictiveVsRealtime:{hvacDifferenceKwh:modes.predictive.hvacKwh-modes.realtime.hvacKwh,
      commandDifferenceSlots,terminalDifferenceC,temperatureComparable,qualifiedSavingPct:null}});
}
const result={id:'CARBON-FIXED-LIGHT-FORECAST-ABLATION-01',version:'20261014-fixed-light-local',
  scenario:'Both HVAC modes use the same 42-lamp full-on schedule and four-region lamp heat; only frozen forecast versus persistence changes.',
  period:'2026-06-29 to 2026-06-30, 06:30–22:30',lightSchedule:'42 × 18 W continuously during the 16-hour replay; not a site meter reading',
  modelSourceSha256:Object.fromEntries(names.map(name=>[name,sha(read(path.join(root,'data',name+'.js')))])),
  limitations:['Four-region occupancy, lighting position, mixing, thermal response and HVAC power are uncalibrated scenarios.',
    'The full-on 300 lx model screen is not met for every proxy occupant; no measured room temperature, desktop illuminance or electricity.',
    'June 29–30 were repeatedly inspected during development; this is not an untouched independent test.'],cases};
const output=JSON.stringify(result,null,2)+'\n';
if(process.argv.includes('--write')){
  fs.writeFileSync(artifactPath,output,{flag:'wx'});
  console.log(`Created ${artifactPath}`);
}else{
  assert.ok(read(artifactPath).equals(Buffer.from(output)),'Frozen fixed-light ablation differs from recomputation');
  console.log(JSON.stringify({passed:true,cases:cases.map(c=>({date:c.date,mixingWPerK:c.mixingWPerK,
    realtimeKwh:c.modes.realtime.hvacKwh,predictiveKwh:c.modes.predictive.hvacKwh,
    ...c.predictiveVsRealtime})),artifactSha256:sha(output)},null,2));
}
