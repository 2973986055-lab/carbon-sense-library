'use strict';

// V2 comparison support. Both daily baselines follow the user's confirmed
// two-unit simultaneous rule on the same unmeasured first-floor people proxy.
const hvacThreeModeV2Model=(()=>{
  const sum=a=>a.reduce((s,v)=>s+v,0);
  function runBaseline(records,setpointC,input={}){
    if(![23,24].includes(setpointC))throw new Error('Baseline setpoint must be 23 or 24 C');
    if(!Array.isArray(records)||records.length!==48||records.some((r,i)=>r.slot!==i||r.date!==records[0].date))throw new Error('Complete chronological day required');
    const s=hvacComfortV2Model.settings(input),plant=hvacResponseModel.plant(s);
    let state=plant.initial(Array(4).fill(s.initialTemperatureC)),metrics=hvacComfortV2Model.metrics(),maxBalanceResidualJ=0;
    const decisions=[],trace=[],permissionChanges=[0,0],setpointChanges=[0,0],unitOnMinutes=[0,0];
    const ledger={storedJ:0,outdoorJ:0,peopleJ:0,lightsJ:0,solarJ:0,mixingJ:0,coolingJ:0,residualJ:0};
    for(let minute=s.startMinute;minute<s.endMinute;minute+=5){
      const record=records[Math.floor(minute/30)],counts=spatialOccupancyModel.allocate(record.floorReservationProxy,s.pattern);
      const desiredId=sum(counts)>0?`${setpointC}_${setpointC}`:'off_off';
      const actualId=state.units.map(u=>u.enabled?u.setpointC:'off').join('_');
      const allowed=hvacPredictiveModel.allowed(state,minute,s),action=allowed.find(a=>a.id===desiredId)||allowed.find(a=>a.id===actualId);
      if(!action)throw new Error('No safe baseline action under device dwell rules');
      const command=hvacPredictiveModel.commandFor(action,state),before=[...state.temperaturesC],energyBefore=metrics.energyKwh;
      for(let u=0;u<2;u++){
        if(command.enabled[u]!==state.units[u].enabled)permissionChanges[u]++;
        if(command.setpointsC[u]!==state.units[u].setpointC)setpointChanges[u]++;
      }
      for(let elapsed=0;elapsed<300-1e-8;){
        const dt=Math.min(plant.settings.stepSeconds,300-elapsed),next=plant.step(state,record,counts,command,dt);
        hvacComfortV2Model.observe(metrics,state.temperaturesC,next.state.temperaturesC,counts,dt,s);
        metrics.energyKwh+=next.hvacKwh;
        for(const key of Object.keys(ledger))ledger[key]+=next.ledger[key];
        maxBalanceResidualJ=Math.max(maxBalanceResidualJ,next.maximumRegionResidualJ,Math.abs(next.ledger.residualJ));
        state=next.state;for(let u=0;u<2;u++)if(state.units[u].on)unitOnMinutes[u]+=dt/60;
        if(input.keepTrace!==false)trace.push({minute:minute+(elapsed+dt)/60,counts:[...counts],command:command.id,temperaturesC:[...state.temperaturesC],on:state.units.map(u=>u.on),powerKw:next.powerKw,hvacKwh:next.hvacKwh});
        elapsed+=dt;
      }
      decisions.push({minute,desiredId,executedId:command.id,delayedByDeviceRule:command.id!==desiredId,
        initialTemperaturesC:before,finalTemperaturesC:[...state.temperaturesC],energyKwh:metrics.energyKwh-energyBefore,
        currentPeopleProxy:sum(counts),usesFutureActual:false});
    }
    return {module:'V2 daily baseline',date:records[0].date,modeId:`baseline_${setpointC}`,settings:s,deviceSetpointC:setpointC,
      scenarioRule:'Both units permitted together when current floor people proxy is positive, otherwise both off; basic device dwell may delay a transition. This is not measured historical operation.',
      metrics,hvacKwh:metrics.energyKwh,occupiedCompliancePct:metrics.occupiedZoneMinutes?100*metrics.withinZoneMinutes/metrics.occupiedZoneMinutes:null,
      emptyCompliancePct:metrics.emptyZoneMinutes?100*metrics.withinEmptyZoneMinutes/metrics.emptyZoneMinutes:null,
      sampledTemperaturePass:hvacComfortV2Model.isFeasible(metrics),permissionChanges,setpointChanges,
      compressorTransitions:state.units.map(u=>u.compressorSwitches),unitOnMinutes,
      delayedDecisionCount:decisions.filter(d=>d.delayedByDeviceRule).length,
      finalTemperaturesC:[...state.temperaturesC],finalState:state,
      storedChangeKwhThermal:sum(plant.parameters.zones.map((z,i)=>z.capacityJPerK*(state.temperaturesC[i]-s.initialTemperatureC)))/3600000,
      ledger,maxBalanceResidualJ,decisions,trace,savingPct:null,isMeasured:false,usesForecast:false,usesFutureActual:false};
  }
  function compare(reference,candidate,terminalToleranceC=.05){
    const sharedKeys=['mixingWPerK','coverage','sensor','responseSeconds','stepSeconds','initialTemperatureC','pattern',
      'ownSegmentShare','massMultiplier','deadbandC','compressorMinimumSeconds','commandMinimumSeconds','setpointMinimumSeconds',
      'startMinute','endMinute'];
    if(reference.date!==candidate.date||sharedKeys.some(key=>reference.settings[key]!==candidate.settings[key]))
      throw new Error('Pair must share date, plant, discretization, initial condition and spatial pattern');
    const maxTerminalTemperatureDifferenceC=Math.max(...reference.finalTemperaturesC.map((t,i)=>Math.abs(t-candidate.finalTemperaturesC[i])));
    const bothTemperaturePass=reference.sampledTemperaturePass&&candidate.sampledTemperaturePass;
    const terminalMatched=maxTerminalTemperatureDifferenceC<=terminalToleranceC;
    const eligible=bothTemperaturePass&&terminalMatched;
    return {referenceModeId:reference.modeId??reference.settings.forecastMode,candidateModeId:candidate.modeId??candidate.settings.forecastMode,
      date:reference.date,rawNominalEnergyDifferenceKwh:reference.hvacKwh-candidate.hvacKwh,
      rawNominalEnergyDifferencePct:100*(reference.hvacKwh-candidate.hvacKwh)/reference.hvacKwh,
      referenceHvacKwh:reference.hvacKwh,candidateHvacKwh:candidate.hvacKwh,
      referenceTemperaturePass:reference.sampledTemperaturePass,candidateTemperaturePass:candidate.sampledTemperaturePass,
      maxTerminalTemperatureDifferenceC,terminalToleranceC,terminalMatched,
      referenceStoredChangeKwhThermal:reference.storedChangeKwhThermal,candidateStoredChangeKwhThermal:candidate.storedChangeKwhThermal,
      storedChangeDifferenceKwhThermal:candidate.storedChangeKwhThermal-reference.storedChangeKwhThermal,
      referenceFinalDeviceState:reference.finalState.units.map(u=>({enabled:u.enabled,on:u.on,setpointC:u.setpointC})),
      candidateFinalDeviceState:candidate.finalState.units.map(u=>({enabled:u.enabled,on:u.on,setpointC:u.setpointC})),
      qualifiedSavingPct:eligible?100*(reference.hvacKwh-candidate.hvacKwh)/reference.hvacKwh:null,
      eligibleForQualifiedSaving:eligible,
      reason:!bothTemperaturePass?'At least one mode fails sampled occupied/empty temperature bounds':!terminalMatched?'Final four-region temperatures are not matched':'Both checks pass under the registered scenario protocol; still simulated, not measured saving'};
  }
  return {runBaseline,compare};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=hvacThreeModeV2Model;
