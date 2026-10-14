'use strict';

// Module 3-B: bounded, discrete rolling search on the unchanged 3-A plant.
// Simulated state feedback only. A failed search is not a global infeasibility proof.
const hvacPredictiveModel=(()=>{
  const sum=a=>a.reduce((s,x)=>s+x,0),EPS=1e-6;
  function value(v,d,lo,hi,name){const n=v??d;if(typeof n!=='number'||!Number.isFinite(n)||n<lo||n>hi)throw new Error('Invalid '+name);return n;}
  function settings(input={}){
    const s={...hvacResponseModel.settings(input),decisionMinutes:5,horizonMinutes:30,
      startMinute:value(input.startMinute,390,0,1410,'start'),endMinute:value(input.endMinute,1350,30,1440,'end'),
      initialTemperatureC:value(input.initialTemperatureC,24,18,35,'initial temperature'),pattern:input.pattern??'west',
      beamWidth:value(input.beamWidth,8,1,32,'search width'),switchObjectiveWh:value(input.switchObjectiveWh,20,0,100,'switch objective'),
      terminalReferenceC:23.75,forecastMode:input.forecastMode??'frozen'};
    if(!Number.isInteger(s.beamWidth)||s.startMinute%30||s.endMinute%30||s.endMinute<=s.startMinute)throw new Error('Use integer search width and chronological half-hour boundaries');
    if(!Object.hasOwn(spatialOccupancyModel.patterns,s.pattern)||!['frozen','persistence'].includes(s.forecastMode))throw new Error('Invalid occupancy or forecast mode');
    return s;
  }
  function projection(record,artifact,minute,counts,s){
    if(!record||record.slot!==Math.floor(minute/30))throw new Error('Current record must match current decision time');
    // Copy only currently available weather. No history array or future record is accepted.
    const weather={outdoorTemperatureC:record.outdoorTemperatureC,southVerticalIrradianceWm2:record.southVerticalIrradianceWm2};
    let people=sum(counts),status=s.forecastMode==='persistence'?'persistence':'frozen',warning=null;
    if(s.forecastMode==='frozen'&&record.slot<47){try{people=reservationModel.transfer(artifact,record.slot,people).people;}catch(e){status='forecast_fallback';warning=e.message;}}
    else if(record.slot===47){status='no_next_slot';warning='No next-day forecast is available';}
    const next=spatialOccupancyModel.allocate(people,s.pattern),boundary=30-minute%30,duration=Math.min(s.horizonMinutes,s.endMinute-minute);
    if(duration<=0)throw new Error('Decision is outside the evaluation window');
    return {weather,currentCounts:[...counts],predictedCounts:next,currentPeople:sum(counts),predictedPeople:people,nextBoundaryMinute:minute+boundary,
      boundarySeconds:boundary*60,durationSeconds:duration*60,futureUsedInWindow:boundary<duration,
      forecastMode:s.forecastMode,forecastStatus:status,forecastWarning:warning,usesFutureActual:false,weatherMode:'current_held'};
  }
  const countsAt=(pr,seconds)=>seconds<pr.boundarySeconds?pr.currentCounts:pr.predictedCounts;
  function commandFor(action,state){return {id:action.id,name:action.name,enabled:[...action.enabled],setpointsC:action.setpointsC.map((t,i)=>action.enabled[i]?t:state.units[i].setpointC)};}
  function currentAction(state){return hvacResponseModel.actions.find(a=>a.id===state.units.map(u=>u.enabled?u.setpointC:'off').join('_'));}
  function allowed(state,minute,s){
    return hvacResponseModel.actions.filter(a=>state.units.every((u,i)=>{
      const time=state.elapsedSeconds,on=a.enabled[i],setpoint=on?a.setpointsC[i]:u.setpointC;
      if(on!==u.enabled&&time-u.lastPermissionChange<s.commandMinimumSeconds-1e-8)return false;
      if(!on&&u.on&&time-u.lastCompressorChange<s.compressorMinimumSeconds-1e-8)return false;
      if(setpoint!==u.setpointC&&time-u.lastSetpointChange<s.setpointMinimumSeconds-1e-8)return false;
      // Do not start a new permission that cannot complete its hold before closing.
      return !on||u.enabled||(s.endMinute-minute)*60>=s.commandMinimumSeconds-1e-8;
    }));
  }
  function commandChanges(state,c){return sum(state.units.map((u,i)=>Number(u.enabled!==c.enabled[i])+Number(u.setpointC!==c.setpointsC[i])));}
  function metrics(){return {energyKwh:0,maximumOccupiedViolationC:0,hotDegreeMinutes:0,coldDegreeMinutes:0,maximumEmptyViolationC:0,emptyDegreeMinutes:0,occupiedZoneMinutes:0,withinZoneMinutes:0,commandChanges:0};}
  function observe(m,before,after,counts,seconds){
    const dt=seconds/60;for(let i=0;i<4;i++){
      const occ=counts[i]>0,low=occ?23:20,high=occ?24:28,a=Math.max(0,low-before[i],before[i]-high),b=Math.max(0,low-after[i],after[i]-high);
      if(occ){m.occupiedZoneMinutes+=dt;if(Math.max(a,b)<1e-7)m.withinZoneMinutes+=dt;m.maximumOccupiedViolationC=Math.max(m.maximumOccupiedViolationC,a,b);
        m.hotDegreeMinutes+=(Math.max(0,before[i]-24)+Math.max(0,after[i]-24))/2*dt;m.coldDegreeMinutes+=(Math.max(0,23-before[i])+Math.max(0,23-after[i]))/2*dt;}
      else{m.maximumEmptyViolationC=Math.max(m.maximumEmptyViolationC,a,b);m.emptyDegreeMinutes+=(a+b)/2*dt;}
    }return m;
  }
  function isFeasible(m){return m.maximumOccupiedViolationC<=EPS&&m.maximumEmptyViolationC<=EPS;}
  function terminalObjective(state,counts,pl,s){
    const cop=pl.parameters.ratedSensibleWPerUnit/1000/pl.parameters.ratedInputKwPerUnit;
    return sum(pl.parameters.zones.map((z,i)=>counts[i]>0?z.capacityJPerK*Math.max(0,state.temperaturesC[i]-s.terminalReferenceC)/3600000/cop:0));
  }
  function compare(a,b){
    const fa=isFeasible(a.metrics),fb=isFeasible(b.metrics);if(fa!==fb)return fa?-1:1;
    if(!fa)for(const k of ['maximumOccupiedViolationC','occupiedDegreeMinutes','maximumEmptyViolationC','emptyDegreeMinutes']){const d=a.metrics[k]-b.metrics[k];if(Math.abs(d)>1e-8)return d;}
    return a.objectiveKwh-b.objectiveKwh||a.sequence.map(c=>c.id).join('/').localeCompare(b.sequence.map(c=>c.id).join('/'));
  }
  function extend(node,action,offset,seconds,pr,pl,s){
    const command=commandFor(action,node.state),m={...node.metrics},changes=commandChanges(node.state,command);m.commandChanges+=changes;
    let state=node.state,used=0;
    while(used<seconds-1e-8){const untilBoundary=pr.boundarySeconds-offset-used,dt=Math.min(pl.settings.stepSeconds,seconds-used,untilBoundary>1e-8?untilBoundary:Infinity),counts=countsAt(pr,offset+used);
      const r=pl.step(state,pr.weather,counts,command,dt);observe(m,state.temperaturesC,r.state.temperaturesC,counts,dt);m.energyKwh+=r.hvacKwh;state=r.state;used+=dt;}
    m.occupiedDegreeMinutes=m.hotDegreeMinutes+m.coldDegreeMinutes;
    const terminalEquivalentObjectiveKwh=terminalObjective(state,countsAt(pr,Math.max(0,offset+seconds-1e-6)),pl,s),switchObjectiveKwh=m.commandChanges*s.switchObjectiveWh/1000;
    return {state,metrics:m,sequence:[...node.sequence,command],boundaries:[...node.boundaries,{offsetMinutes:(offset+seconds)/60,temperaturesC:[...state.temperaturesC],counts:[...countsAt(pr,Math.max(0,offset+seconds-1e-6))],on:state.units.map(u=>u.on),command}],
      terminalEquivalentObjectiveKwh,switchObjectiveKwh,objectiveKwh:m.energyKwh+terminalEquivalentObjectiveKwh+switchObjectiveKwh};
  }
  function holdDiagnostic(state,pr,pl,s){
    const command=commandFor(currentAction(state),state),hotspots=[],overcold=[],seenHot=new Set(),seenCold=new Set();let offset=0;
    while(offset<pr.durationSeconds-1e-8){const dt=Math.min(pl.settings.stepSeconds,pr.durationSeconds-offset,pr.boundarySeconds-offset>1e-8?pr.boundarySeconds-offset:Infinity),n=countsAt(pr,offset),r=pl.step(state,pr.weather,n,command,dt);
      for(let i=0;i<4;i++)if(n[i]>0){if(r.state.temperaturesC[i]>24+EPS&&!seenHot.has(i)){seenHot.add(i);hotspots.push({zone:i,offsetMinutes:(offset+dt)/60,temperatureC:r.state.temperaturesC[i]});}if(r.state.temperaturesC[i]<23-EPS&&!seenCold.has(i)){seenCold.add(i);overcold.push({zone:i,offsetMinutes:(offset+dt)/60,temperatureC:r.state.temperaturesC[i]});}}
      state=r.state;offset+=dt;
    }return {command,hotspots,overcold,meaning:'If the current high-level command is held; not an observed future temperature'};
  }
  function decision(state,record,counts,minute,artifact,pl,input={}){
    const s=settings(input),pr=projection(record,artifact,minute,counts,s);let beam=[{state,metrics:metrics(),sequence:[],boundaries:[]}],generated=0,offset=0;
    while(offset<pr.durationSeconds-1e-8){const seconds=Math.min(300,pr.durationSeconds-offset),expanded=[];
      for(const node of beam)for(const action of allowed(node.state,minute+offset/60,s)){expanded.push(extend(node,action,offset,seconds,pr,pl,s));generated++;}
      if(!expanded.length)throw new Error('No legal command sequence; preserve the prior command and check device state');
      expanded.sort(compare);beam=expanded.slice(0,s.beamWidth);offset+=seconds;
    }
    beam.sort(compare);const best=beam[0],diagnostic=holdDiagnostic(state,pr,pl,s),events=pr.futureUsedInWindow?pr.currentCounts.flatMap((n,i)=>
      n===0&&pr.predictedCounts[i]>0?[{zone:i,type:'arrival',boundaryMinute:pr.nextBoundaryMinute}]:n>0&&pr.predictedCounts[i]===0?[{zone:i,type:'departure',boundaryMinute:pr.nextBoundaryMinute}]:[]):[];
    return {minute,stateAtDecision:state,command:best.sequence[0],projection:pr,best,holdDiagnostic:diagnostic,events,
      search:{beamWidth:s.beamWidth,generatedBlocks:generated,retainedTerminalSequences:beam.length,feasibleTerminalSequences:beam.filter(n=>isFeasible(n.metrics)).length,isGlobalOptimal:false},
      status:isFeasible(best.metrics)?'searched_feasible':'searched_no_feasible',
      reason:isFeasible(best.metrics)?'保留候选满足采样温度边界，按名义电量、切换及末端热状态目标选择，先执行5分钟':'本次有限候选搜索未找到全窗口达标序列；执行违规较少的回退动作并保留失败记录',
      candidates:beam.map(n=>({first:n.sequence[0].id,sequence:n.sequence.map(c=>c.id),metrics:n.metrics,terminalEquivalentObjectiveKwh:n.terminalEquivalentObjectiveKwh,switchObjectiveKwh:n.switchObjectiveKwh,objectiveKwh:n.objectiveKwh}))};
  }
  function runDay(records,artifact,input={}){
    if(!Array.isArray(records)||records.length!==48||records.some((r,i)=>r.slot!==i||r.date!==records[0].date))throw new Error('Complete chronological day required');
    const s=settings(input),planner=hvacResponseModel.plant(s),feedback=hvacResponseModel.plant({...s,...input.feedbackThermalSettings}),initial=Array(4).fill(s.initialTemperatureC);
    // Unknown device protection is shared; thermal/coverage mismatch may be tested separately.
    for(const key of ['commandMinimumSeconds','setpointMinimumSeconds','compressorMinimumSeconds','stepSeconds'])if(planner.settings[key]!==feedback.settings[key])throw new Error('Feedback mismatch is restricted to thermal and response assumptions');
    let state=feedback.initial(initial),m=metrics(),maxResidualJ=0,minTemperatureC=Math.min(...initial),maxTemperatureC=Math.max(...initial);
    const trace=[],decisions=[],unitOnMinutes=[0,0],unitPermissionMinutes=[0,0],unitPermissionChanges=[0,0],unitSetpointChanges=[0,0],ledger={storedJ:0,outdoorJ:0,peopleJ:0,lightsJ:0,solarJ:0,mixingJ:0,coolingJ:0,residualJ:0};
    for(let minute=s.startMinute;minute<s.endMinute;minute+=5){
      const record=records[Math.floor(minute/30)],counts=spatialOccupancyModel.allocate(record.floorReservationProxy,s.pattern),d=decision(state,record,counts,minute,artifact,planner,s);
      const c=d.command;for(let u=0;u<2;u++){if(c.enabled[u]!==state.units[u].enabled)unitPermissionChanges[u]++;if(c.setpointsC[u]!==state.units[u].setpointC)unitSetpointChanges[u]++;}m.commandChanges+=commandChanges(state,c);
      const before=[...state.temperaturesC],energyBefore=m.energyKwh;
      for(let used=0;used<300-1e-8;){const dt=Math.min(feedback.settings.stepSeconds,300-used),r=feedback.step(state,record,counts,c,dt);
        observe(m,state.temperaturesC,r.state.temperaturesC,counts,dt);m.energyKwh+=r.hvacKwh;for(const k of Object.keys(ledger))ledger[k]+=r.ledger[k];maxResidualJ=Math.max(maxResidualJ,r.maximumRegionResidualJ,Math.abs(r.ledger.residualJ));
        state=r.state;minTemperatureC=Math.min(minTemperatureC,...state.temperaturesC);maxTemperatureC=Math.max(maxTemperatureC,...state.temperaturesC);
        for(let u=0;u<2;u++){if(state.units[u].on)unitOnMinutes[u]+=dt/60;if(state.units[u].enabled)unitPermissionMinutes[u]+=dt/60;}
        if(input.keepTrace!==false)trace.push({minute:minute+(used+dt)/60,temperaturesC:[...state.temperaturesC],counts:[...counts],command:c.id,on:state.units.map(u=>u.on),coolingKw:r.unitCoolingW.map(q=>q/1000),powerKw:r.powerKw,hvacKwh:r.hvacKwh});used+=dt;
      }
      decisions.push({...d,executedFirstBlock:{initialTemperaturesC:before,finalTemperaturesC:[...state.temperaturesC],energyKwh:m.energyKwh-energyBefore},simulatedFeedback:true});
      if(typeof input.onDecision==='function')input.onDecision({minute,status:d.status,energyKwh:m.energyKwh});
    }
    m.occupiedDegreeMinutes=m.hotDegreeMinutes+m.coldDegreeMinutes;
    return {module:'3-B',date:records[0].date,settings:s,feedbackSettings:feedback.settings,forecastTrainingDates:artifact?.trainingLabels??artifact?.trainingDates??null,
      hvacKwh:m.energyKwh,metrics:m,temperatureCompliancePct:m.occupiedZoneMinutes?m.withinZoneMinutes/m.occupiedZoneMinutes*100:null,
      sampledTemperaturePass:isFeasible(m),noFeasibleSearchDecisions:decisions.filter(d=>d.status!=='searched_feasible').length,
      unitOnMinutes,unitPermissionMinutes,unitPermissionChanges,unitSetpointChanges,compressorTransitions:state.units.map(u=>u.compressorSwitches),
      initialTemperaturesC:initial,finalTemperaturesC:[...state.temperaturesC],finalState:state,
      storedChangeKwhThermal:sum(feedback.parameters.zones.map((z,i)=>z.capacityJPerK*(state.temperaturesC[i]-initial[i])))/3600000,
      minTemperatureC,maxTemperatureC,outsideDiagnosticRange:minTemperatureC<16||maxTemperatureC>40,ledger,maxBalanceResidualJ:maxResidualJ,decisions,trace,
      savingPct:null,isMeasured:false,usesFutureActual:false,
      limitations:'有限束搜索、当前天气保持、冻结下一半小时人数及假设分区。失败不证明所有序列不可行；末温和储热保留，未做3-C共同结算与三模式比较，不提供节电率。'};
  }
  return {settings,projection,countsAt,commandFor,allowed,observe,isFeasible,decision,runDay};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=hvacPredictiveModel;
