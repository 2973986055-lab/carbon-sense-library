'use strict';

// Candidate only. The 11-person materiality threshold was fixed from 6/24-28
// proxy errors before replaying 6/29-30; it is not a measured occupancy CI.
const hvacForecastGuardV3Model=(()=>{
  const thresholdPeople=11,sum=a=>a.reduce((s,v)=>s+v,0);
  function settings(input={}){
    if(input.thresholdPeople!==undefined&&input.thresholdPeople!==thresholdPeople)throw new Error('V3 training threshold is versioned and fixed');
    if(input.allowHoldException===true)throw new Error('V3 uses the unchanged V2 no-exception protocol');
    return {...hvacComfortV2Model.settings({...input,allowHoldException:false,forecastMode:'frozen'}),thresholdPeople};
  }
  function relaxes(predictive,realtime){
    return [0,1].some(i=>realtime.enabled[i]&&(!predictive.enabled[i]||
      predictive.setpointsC[i]>realtime.setpointsC[i]));
  }
  function decision(state,record,counts,minute,artifact,plant,memory,input={}){
    const s=settings(input),realtime=hvacComfortV2Model.decision(state,record,counts,minute,artifact,plant,memory,{...s,forecastMode:'persistence'});
    const projection=hvacPredictiveModel.projection(record,artifact,minute,counts,s);
    const differencePeople=projection.predictedPeople-projection.currentPeople;
    let predictive=null,reason='no_future_boundary';
    if(projection.futureUsedInWindow&&Math.abs(differencePeople)<=thresholdPeople)reason='within_training_error_guard';
    else if(projection.futureUsedInWindow){
      predictive=hvacComfortV2Model.decision(state,record,counts,minute,artifact,plant,memory,s);
      reason=differencePeople>0&&relaxes(predictive.command,realtime.command)?'increase_relaxation_veto':'forecast_selected';
    }
    const selected=reason==='forecast_selected'?predictive:realtime;
    return {...selected,forecastGuard:{reason,thresholdPeople,differencePeople,
      currentPeopleProxy:projection.currentPeople,frozenNextPeopleProxy:projection.predictedPeople,
      realtimeCommand:realtime.command.id,predictiveCommand:predictive?.command.id??null,
      chosenCommand:selected.command.id,usesFutureActual:false}};
  }
  function runDay(records,artifact,input={}){
    if(!Array.isArray(records)||records.length!==48||records.some((r,i)=>r.slot!==i||r.date!==records[0].date))throw new Error('Complete chronological day required');
    const s=settings(input),plant=hvacResponseModel.plant(s);
    let state=plant.initial(Array(4).fill(s.initialTemperatureC)),memory=hvacSupervisoryModel.memory(),m=hvacComfortV2Model.metrics(),maxBalanceResidualJ=0;
    const decisions=[],trace=[],permissionChanges=[0,0],setpointChanges=[0,0],unitOnMinutes=[0,0];
    const ledger={storedJ:0,outdoorJ:0,peopleJ:0,lightsJ:0,solarJ:0,mixingJ:0,coolingJ:0,residualJ:0};
    for(let minute=s.startMinute;minute<s.endMinute;minute+=5){
      const record=records[Math.floor(minute/30)],counts=spatialOccupancyModel.allocate(record.floorReservationProxy,s.pattern);
      memory=hvacSupervisoryModel.observeSlot(memory,record.slot,counts);
      const d=decision(state,record,counts,minute,artifact,plant,memory,s),command=d.command;
      for(let u=0;u<2;u++){
        if(command.enabled[u]!==state.units[u].enabled)permissionChanges[u]++;
        if(command.setpointsC[u]!==state.units[u].setpointC)setpointChanges[u]++;
      }
      m.commandChanges+=sum(state.units.map((u,i)=>Number(u.enabled!==command.enabled[i])+Number(u.setpointC!==command.setpointsC[i])));
      const initialTemperaturesC=[...state.temperaturesC],energyBefore=m.energyKwh;
      for(let elapsed=0;elapsed<300-1e-8;){
        const dt=Math.min(plant.settings.stepSeconds,300-elapsed),next=plant.step(state,record,counts,command,dt);
        hvacComfortV2Model.observe(m,state.temperaturesC,next.state.temperaturesC,counts,dt,s);m.energyKwh+=next.hvacKwh;
        for(const key of Object.keys(ledger))ledger[key]+=next.ledger[key];
        maxBalanceResidualJ=Math.max(maxBalanceResidualJ,next.maximumRegionResidualJ,Math.abs(next.ledger.residualJ));
        state=next.state;for(let u=0;u<2;u++)if(state.units[u].on)unitOnMinutes[u]+=dt/60;
        if(input.keepTrace!==false)trace.push({minute:minute+(elapsed+dt)/60,counts:[...counts],command:command.id,
          temperaturesC:[...state.temperaturesC],on:state.units.map(u=>u.on),powerKw:next.powerKw,hvacKwh:next.hvacKwh});
        elapsed+=dt;
      }
      decisions.push({...d,executedFirstBlock:{initialTemperaturesC,finalTemperaturesC:[...state.temperaturesC],energyKwh:m.energyKwh-energyBefore}});
    }
    const gateReasons=Object.fromEntries(['no_future_boundary','within_training_error_guard','increase_relaxation_veto','forecast_selected'].map(reason=>
      [reason,decisions.filter(d=>d.forecastGuard.reason===reason).length]));
    return {module:'V3 guarded forecast candidate',modeId:'predictive_guarded_v3',date:records[0].date,settings:s,metrics:m,hvacKwh:m.energyKwh,
      occupiedCompliancePct:m.occupiedZoneMinutes?100*m.withinZoneMinutes/m.occupiedZoneMinutes:null,
      emptyCompliancePct:m.emptyZoneMinutes?100*m.withinEmptyZoneMinutes/m.emptyZoneMinutes:null,
      sampledTemperaturePass:hvacComfortV2Model.isFeasible(m),gateReasons,permissionChanges,setpointChanges,
      compressorTransitions:state.units.map(u=>u.compressorSwitches),unitOnMinutes,
      finalTemperaturesC:[...state.temperaturesC],finalState:state,
      storedChangeKwhThermal:sum(plant.parameters.zones.map((z,i)=>z.capacityJPerK*(state.temperaturesC[i]-s.initialTemperatureC)))/3600000,
      ledger,maxBalanceResidualJ,decisions,trace,savingPct:null,isMeasured:false,usesFutureActual:false,
      note:'Training-derived forecast gate; four-zone occupancy, thermal coupling and nominal electricity are uncalibrated. No qualified saving until paired comparison.'};
  }
  return {thresholdPeople,settings,relaxes,decision,runDay};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=hvacForecastGuardV3Model;
