'use strict';

// Candidate V2 room-air acceptance controller. The original V1 controller and
// its strict 23..24 C protocol remain unchanged for historical replay.
const hvacComfortV2Model=(()=>{
  const groups=[[0,2],[1,3]],sum=a=>a.reduce((s,v)=>s+v,0),EPS=1e-6;
  const band=Object.freeze({occupiedLowerC:22.2,occupiedUpperC:26.8,emptyLowerC:20,emptyUpperC:28});
  function settings(input={}){
    const s={...hvacSupervisoryModel.settings(input),...band,
      allowHoldException:input.allowHoldException??false,exceptionCooldownMinutes:60};
    if(typeof s.allowHoldException!=='boolean')throw new Error('Hold exception flag must be boolean');
    for(const key of Object.keys(band))if(input[key]!==undefined&&input[key]!==band[key])throw new Error('V2 acceptance band is versioned and fixed');
    return s;
  }
  function within(temperatures,counts,s){return temperatures.every((t,i)=>t>=(counts[i]>0?s.occupiedLowerC:s.emptyLowerC)-EPS&&t<=(counts[i]>0?s.occupiedUpperC:s.emptyUpperC)+EPS);}
  function presentAction(state){return hvacResponseModel.actions.find(a=>a.id===state.units.map(u=>u.enabled?u.setpointC:'off').join('_'));}
  function probe(state,projection,offset,plant,s){
    const command=hvacPredictiveModel.commandFor(presentAction(state),state),hotRuns=[0,0,0,0],coldRuns=[0,0,0,0],longHot=[0,0,0,0],longCold=[0,0,0,0],hot=new Set(),cold=new Set();
    let emptyHigh=false,emptyLow=false,time=offset;
    while(time<projection.durationSeconds-1e-8){
      const left=projection.boundarySeconds-time,dt=Math.min(plant.settings.stepSeconds,projection.durationSeconds-time,left>1e-8?left:Infinity);
      const counts=hvacPredictiveModel.countsAt(projection,time),next=plant.step(state,projection.weather,counts,command,dt).state;
      for(let i=0;i<4;i++){
        const before=state.temperaturesC[i],after=next.temperaturesC[i];
        if(counts[i]>0){
          if(before>s.occupiedUpperC+EPS)hot.add(i);if(before<s.occupiedLowerC-EPS)cold.add(i);
          hotRuns[i]=after>=s.occupiedUpperC-s.guardMarginC?hotRuns[i]+dt/60:0;
          coldRuns[i]=after<=s.occupiedLowerC+s.guardMarginC?coldRuns[i]+dt/60:0;
          longHot[i]=Math.max(longHot[i],hotRuns[i]);longCold[i]=Math.max(longCold[i],coldRuns[i]);
        }else{
          hotRuns[i]=0;coldRuns[i]=0;
          if(Math.max(before,after)>s.emptyUpperC+EPS)emptyHigh=true;
          if(Math.min(before,after)<s.emptyLowerC-EPS)emptyLow=true;
        }
      }
      state=next;time+=dt;
    }
    for(let i=0;i<4;i++){
      if(longHot[i]>=s.guardDurationMinutes-1e-8)hot.add(i);
      if(longCold[i]>=s.guardDurationMinutes-1e-8)cold.add(i);
    }
    const now=hvacPredictiveModel.countsAt(projection,offset),futureUsed=offset<projection.boundarySeconds&&projection.boundarySeconds<projection.durationSeconds;
    const future=futureUsed?projection.predictedCounts:now;
    return {heldCommand:command.id,hotZones:[...hot],coldZones:[...cold],emptyHigh,emptyLow,
      currentGroupPeople:groups.map(g=>sum(g.map(i=>now[i]))),futureGroupPeople:groups.map(g=>sum(g.map(i=>future[i]))),futureUsed,
      meaning:'Predicted risk if the current high-level instruction is held; not observed future temperature'};
  }
  function gate(actions,state,signal,mem,s){
    const hot=signal.hotZones.length>0||signal.emptyHigh,cold=signal.coldZones.length>0||signal.emptyLow;
    return actions.filter(a=>state.units.every((u,i)=>{
      const target=a.enabled[i]?a.setpointsC[i]:u.setpointC;
      const decline=signal.futureUsed&&signal.futureGroupPeople[i]<signal.currentGroupPeople[i];
      const confirmed=mem.emptyRuns[i]>=s.emptyObservedSlots&&signal.currentGroupPeople[i]===0&&signal.futureGroupPeople[i]===0;
      if(!u.enabled&&a.enabled[i]&&!hot)return false;
      if(u.enabled&&!a.enabled[i]&&!cold&&!decline&&!confirmed)return false;
      if(target<u.setpointC&&!hot)return false;
      if(target>u.setpointC&&!cold&&!decline&&!confirmed)return false;
      return true;
    }));
  }
  function legal(state,minute,s){return hvacSupervisoryModel.legal(state,minute,s);}
  function metrics(){return {energyKwh:0,maximumOccupiedViolationC:0,hotDegreeMinutes:0,coldDegreeMinutes:0,occupiedDegreeMinutes:0,
    maximumEmptyViolationC:0,emptyDegreeMinutes:0,occupiedZoneMinutes:0,withinZoneMinutes:0,emptyZoneMinutes:0,withinEmptyZoneMinutes:0,commandChanges:0};}
  function observe(m,before,after,counts,seconds,s){
    const dt=seconds/60;
    for(let i=0;i<4;i++){
      const occupied=counts[i]>0,lo=occupied?s.occupiedLowerC:s.emptyLowerC,hi=occupied?s.occupiedUpperC:s.emptyUpperC;
      const a=Math.max(0,lo-before[i],before[i]-hi),b=Math.max(0,lo-after[i],after[i]-hi),v=Math.max(a,b);
      if(occupied){
        m.occupiedZoneMinutes+=dt;if(v<1e-7)m.withinZoneMinutes+=dt;
        m.maximumOccupiedViolationC=Math.max(m.maximumOccupiedViolationC,v);
        m.hotDegreeMinutes+=(Math.max(0,before[i]-hi)+Math.max(0,after[i]-hi))*.5*dt;
        m.coldDegreeMinutes+=(Math.max(0,lo-before[i])+Math.max(0,lo-after[i]))*.5*dt;
      }else{
        m.emptyZoneMinutes+=dt;if(v<1e-7)m.withinEmptyZoneMinutes+=dt;
        m.maximumEmptyViolationC=Math.max(m.maximumEmptyViolationC,v);
        m.emptyDegreeMinutes+=(a+b)*.5*dt;
      }
    }
    m.occupiedDegreeMinutes=m.hotDegreeMinutes+m.coldDegreeMinutes;
  }
  function isFeasible(m){return m.maximumOccupiedViolationC<=EPS&&m.maximumEmptyViolationC<=EPS;}
  function changes(state,command){return sum(state.units.map((u,i)=>Number(u.enabled!==command.enabled[i])+Number(u.setpointC!==command.setpointsC[i])));}
  function rank(a,b){
    const fa=isFeasible(a.metrics),fb=isFeasible(b.metrics);if(fa!==fb)return fa?-1:1;
    if(!fa)for(const key of ['maximumOccupiedViolationC','occupiedDegreeMinutes','maximumEmptyViolationC','emptyDegreeMinutes']){
      const d=a.metrics[key]-b.metrics[key];if(Math.abs(d)>1e-8)return d;
    }
    return a.objectiveKwh-b.objectiveKwh||a.metrics.commandChanges-b.metrics.commandChanges||
      sum(a.state.units.map(u=>Number(u.enabled)))-sum(b.state.units.map(u=>Number(u.enabled)))||
      a.sequence.map(x=>x.id).join('/').localeCompare(b.sequence.map(x=>x.id).join('/'));
  }
  function extend(node,action,offset,seconds,projection,plant,s,signal){
    const command=hvacPredictiveModel.commandFor(action,node.state),m={...node.metrics};m.commandChanges+=changes(node.state,command);
    let state=node.state,time=offset;
    while(time<offset+seconds-1e-8){
      const left=projection.boundarySeconds-time,dt=Math.min(plant.settings.stepSeconds,offset+seconds-time,left>1e-8?left:Infinity);
      const counts=hvacPredictiveModel.countsAt(projection,time),next=plant.step(state,projection.weather,counts,command,dt);
      observe(m,state.temperaturesC,next.state.temperaturesC,counts,dt,s);m.energyKwh+=next.hvacKwh;state=next.state;time+=dt;
    }
    return {state,metrics:m,sequence:[...node.sequence,command],boundaries:[...node.boundaries,{offsetMinutes:(offset+seconds)/60,temperaturesC:[...state.temperaturesC],command:command.id,signal}],
      objectiveKwh:m.energyKwh+m.commandChanges*s.switchObjectiveWh/1000};
  }
  function decision(state,record,counts,minute,artifact,plant,mem,input={},lastExceptionMinute=-Infinity){
    const s=settings(input),projection=hvacPredictiveModel.projection(record,artifact,minute,counts,s);
    const signal=probe(state,projection,0,plant,s),rootLegal=legal(state,minute,s),rootActions=gate(rootLegal,state,signal,mem,s);
    const blank={state,metrics:metrics(),sequence:[],boundaries:[]},firstSeconds=Math.min(300,projection.durationSeconds);
    let first=rootActions.map(a=>extend(blank,a,0,firstSeconds,projection,plant,s,signal));
    const originalFirstFeasible=first.some(n=>isFeasible(n.metrics));
    let exceptionActions=[];
    if(s.allowHoldException&&within(state.temperaturesC,counts,s)&&!originalFirstFeasible&&minute-lastExceptionMinute>=s.exceptionCooldownMinutes){
      const original=new Set(rootActions.map(a=>a.id));
      const physical=hvacPredictiveModel.allowed(state,minute,s);
      exceptionActions=gate(physical,state,signal,mem,s).filter(a=>!original.has(a.id)).map(a=>({action:a,node:extend(blank,a,0,firstSeconds,projection,plant,s,signal)})).filter(x=>isFeasible(x.node.metrics));
      first.push(...exceptionActions.map(x=>x.node));
    }
    const currentWithin=within(state.temperaturesC,counts,s),safetyApplied=currentWithin&&first.some(n=>isFeasible(n.metrics));
    if(safetyApplied)first=first.filter(n=>isFeasible(n.metrics));
    if(!first.length)throw new Error('No admissible first action');
    first.sort(rank);let beam=first.slice(0,s.beamWidth),offset=firstSeconds,generated=first.length;
    while(offset<projection.durationSeconds-1e-8){
      const seconds=Math.min(300,projection.durationSeconds-offset),nodes=[];
      for(const node of beam){
        const futureSignal=probe(node.state,projection,offset,plant,s);
        for(const action of gate(legal(node.state,minute+offset/60,s),node.state,futureSignal,mem,s)){
          nodes.push(extend(node,action,offset,seconds,projection,plant,s,futureSignal));generated++;
        }
      }
      if(!nodes.length)throw new Error('No admissible future continuation');
      nodes.sort(rank);beam=nodes.slice(0,s.beamWidth);offset+=seconds;
    }
    beam.sort(rank);const best=beam[0],command=best.sequence[0],usedHoldException=exceptionActions.some(x=>x.action.id===command.id);
    return {minute,stateAtDecision:state,observationMemory:mem,projection,signal,command,best,
      rootLegalActions:rootLegal.map(a=>a.id),rootTriggeredActions:rootActions.map(a=>a.id),
      rootExceptionActions:exceptionActions.map(x=>x.action.id),usedHoldException,firstBlockSafetyApplied:safetyApplied,
      originalFirstBlockFeasible:originalFirstFeasible,firstBlockFeasibleAfterException:safetyApplied,
      search:{beamWidth:s.beamWidth,generatedBlocks:generated,retainedTerminalSequences:beam.length,
        feasibleTerminalSequences:beam.filter(n=>isFeasible(n.metrics)).length,isGlobalOptimal:false},
      status:isFeasible(best.metrics)?'searched_feasible':'searched_no_feasible',
      reason:isFeasible(best.metrics)?'V2边界下有限搜索找到可行采样序列，执行首5分钟':'V2边界下有限搜索未找到全窗口可行序列；保留越界并执行较少违规方案'};
  }
  function runDay(records,artifact,input={}){
    if(!Array.isArray(records)||records.length!==48||records.some((r,i)=>r.slot!==i||r.date!==records[0].date))throw new Error('Complete chronological day required');
    const s=settings(input),plant=hvacResponseModel.plant(s);
    let state=plant.initial(Array(4).fill(s.initialTemperatureC)),mem=hvacSupervisoryModel.memory(),m=metrics(),lastExceptionMinute=-Infinity,maxBalanceResidualJ=0;
    const decisions=[],trace=[],permissionChanges=[0,0],setpointChanges=[0,0],unitOnMinutes=[0,0];
    const ledger={storedJ:0,outdoorJ:0,peopleJ:0,lightsJ:0,solarJ:0,mixingJ:0,coolingJ:0,residualJ:0};
    for(let minute=s.startMinute;minute<s.endMinute;minute+=5){
      const record=records[Math.floor(minute/30)],counts=spatialOccupancyModel.allocate(record.floorReservationProxy,s.pattern);
      mem=hvacSupervisoryModel.observeSlot(mem,record.slot,counts);
      const d=decision(state,record,counts,minute,artifact,plant,mem,s,lastExceptionMinute),command=d.command;
      if(d.usedHoldException)lastExceptionMinute=minute;
      for(let u=0;u<2;u++){
        if(command.enabled[u]!==state.units[u].enabled)permissionChanges[u]++;
        if(command.setpointsC[u]!==state.units[u].setpointC)setpointChanges[u]++;
      }
      m.commandChanges+=changes(state,command);const initialTemperaturesC=[...state.temperaturesC],energyBefore=m.energyKwh;
      for(let elapsed=0;elapsed<300-1e-8;){
        const dt=Math.min(plant.settings.stepSeconds,300-elapsed),next=plant.step(state,record,counts,command,dt);
        observe(m,state.temperaturesC,next.state.temperaturesC,counts,dt,s);m.energyKwh+=next.hvacKwh;
        for(const key of Object.keys(ledger))ledger[key]+=next.ledger[key];
        maxBalanceResidualJ=Math.max(maxBalanceResidualJ,next.maximumRegionResidualJ,Math.abs(next.ledger.residualJ));
        state=next.state;for(let u=0;u<2;u++)if(state.units[u].on)unitOnMinutes[u]+=dt/60;
        if(input.keepTrace!==false)trace.push({minute:minute+(elapsed+dt)/60,counts:[...counts],command:command.id,temperaturesC:[...state.temperaturesC],on:state.units.map(u=>u.on),powerKw:next.powerKw,hvacKwh:next.hvacKwh});
        elapsed+=dt;
      }
      decisions.push({...d,executedFirstBlock:{initialTemperaturesC,finalTemperaturesC:[...state.temperaturesC],energyKwh:m.energyKwh-energyBefore}});
      if(typeof input.onDecision==='function')input.onDecision({minute,status:d.status});
    }
    return {module:'V2 occupied room-air band candidate',date:records[0].date,settings:s,metrics:m,hvacKwh:m.energyKwh,
      occupiedCompliancePct:m.occupiedZoneMinutes?100*m.withinZoneMinutes/m.occupiedZoneMinutes:null,
      emptyCompliancePct:m.emptyZoneMinutes?100*m.withinEmptyZoneMinutes/m.emptyZoneMinutes:null,
      sampledTemperaturePass:isFeasible(m),permissionChanges,setpointChanges,
      compressorTransitions:state.units.map(u=>u.compressorSwitches),unitOnMinutes,
      finalTemperaturesC:[...state.temperaturesC],finalState:state,
      storedChangeKwhThermal:sum(plant.parameters.zones.map((z,i)=>z.capacityJPerK*(state.temperaturesC[i]-s.initialTemperatureC)))/3600000,
      ledger,maxBalanceResidualJ,holdExceptionCount:decisions.filter(d=>d.usedHoldException).length,
      firstBlockSafetyAppliedCount:decisions.filter(d=>d.firstBlockSafetyApplied).length,
      failedSearchDecisionCount:decisions.filter(d=>d.status!=='searched_feasible').length,
      decisions,trace,savingPct:null,isMeasured:false,usesFutureActual:false,formalThreeModeComparisonStarted:false,
      note:'Under user-selected V2 22.2..26.8 C occupied band; old response plant and frozen forecast. No qualified energy saving or room-temperature field validation.'};
  }
  return {band,settings,within,probe,gate,metrics,observe,isFeasible,legal,decision,runDay};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=hvacComfortV2Model;
