'use strict';

// Low-frequency supervisory revision: no manufacturer-validated controller claims.
// The unchanged response model still handles each machine's internal thermostat.
const hvacSupervisoryModel=(()=>{
  const sum=a=>a.reduce((n,x)=>n+x,0),groups=[[0,2],[1,3]],EPS=1e-6;
  const defaults=Object.freeze({permissionHoldMinutes:20,setpointHoldMinutes:20,guardMarginC:.1,guardDurationMinutes:2,emptyObservedSlots:2});
  function settings(input={}){
    const s={...hvacPredictiveModel.settings(input),...defaults};
    for(const key of ['permissionHoldMinutes','setpointHoldMinutes']){s[key]=input[key]??defaults[key];if(![10,20,30].includes(s[key]))throw new Error('Supervisory holds must be 10, 20 or 30 minutes');}
    s.guardMarginC=input.guardMarginC??defaults.guardMarginC;if(![0,.1,.2].includes(s.guardMarginC))throw new Error('Guard margin must be 0, 0.1 or 0.2 C');
    if(input.emptyObservedSlots!==undefined&&input.emptyObservedSlots!==2)throw new Error('Use two distinct observed slots for vacancy confirmation');
    return s;
  }
  function memory(){return {lastObservedSlot:null,emptyRuns:[0,0],isObservedProxy:true};}
  function observeSlot(mem,slot,counts){
    if(!Number.isInteger(slot)||slot<0||slot>47)throw new Error('Invalid observed slot');
    if(mem.lastObservedSlot!==null&&slot<mem.lastObservedSlot)throw new Error('Observations cannot run backwards');
    if(slot===mem.lastObservedSlot)return {lastObservedSlot:mem.lastObservedSlot,emptyRuns:[...mem.emptyRuns],isObservedProxy:true};
    return {lastObservedSlot:slot,emptyRuns:groups.map((g,u)=>sum(g.map(i=>counts[i]))===0?(mem.lastObservedSlot===slot-1?mem.emptyRuns[u]:0)+1:0),isObservedProxy:true};
  }
  function actionNow(state){return hvacResponseModel.actions.find(a=>a.id===state.units.map(u=>u.enabled?u.setpointC:'off').join('_'));}
  function probe(state,pr,offset,pl,s){
    const command=hvacPredictiveModel.commandFor(actionNow(state),state),hotRun=[0,0,0,0],coldRun=[0,0,0,0],longHot=[0,0,0,0],longCold=[0,0,0,0],hotZones=new Set(),coldZones=new Set();
    let emptyHigh=false,emptyLow=false,time=offset;
    while(time<pr.durationSeconds-1e-8){const until=pr.boundarySeconds-time,dt=Math.min(pl.settings.stepSeconds,pr.durationSeconds-time,until>1e-8?until:Infinity),n=hvacPredictiveModel.countsAt(pr,time),r=pl.step(state,pr.weather,n,command,dt);
      for(let i=0;i<4;i++){
        const before=state.temperaturesC[i],t=r.state.temperaturesC[i];
        if(n[i]>0){
          if(before>24+EPS)hotZones.add(i);if(before<23-EPS)coldZones.add(i);
          hotRun[i]=t>=24-s.guardMarginC?hotRun[i]+dt/60:0;coldRun[i]=t<=23+s.guardMarginC?coldRun[i]+dt/60:0;
          longHot[i]=Math.max(longHot[i],hotRun[i]);longCold[i]=Math.max(longCold[i],coldRun[i]);
        }else{hotRun[i]=0;coldRun[i]=0;if(Math.max(before,t)>28+EPS)emptyHigh=true;if(Math.min(before,t)<20-EPS)emptyLow=true;}
      }
      state=r.state;time+=dt;
    }
    for(let i=0;i<4;i++){if(longHot[i]>=s.guardDurationMinutes-1e-8)hotZones.add(i);if(longCold[i]>=s.guardDurationMinutes-1e-8)coldZones.add(i);}
    const now=hvacPredictiveModel.countsAt(pr,offset),futureUsed=offset<pr.boundarySeconds&&pr.boundarySeconds<pr.durationSeconds,next=futureUsed?pr.predictedCounts:now;
    return {heldCommand:command.id,hotZones:[...hotZones],coldZones:[...coldZones],emptyHigh,emptyLow,
      currentGroupPeople:groups.map(g=>sum(g.map(i=>now[i]))),futureGroupPeople:groups.map(g=>sum(g.map(i=>next[i]))),
      futureUsed,meaning:'Guard in the conditional trajectory while retaining current command; not a measured hotspot'};
  }
  function legal(state,minute,s){return hvacPredictiveModel.allowed(state,minute,s).filter(a=>state.units.every((u,i)=>{
    const elapsed=state.elapsedSeconds;if(a.enabled[i]!==u.enabled&&elapsed-u.lastPermissionChange<s.permissionHoldMinutes*60-1e-8)return false;
    if(a.enabled[i]&&a.setpointsC[i]!==u.setpointC&&elapsed-u.lastSetpointChange<s.setpointHoldMinutes*60-1e-8)return false;
    return !a.enabled[i]||u.enabled||s.endMinute-minute>=s.permissionHoldMinutes-1e-8;
  }));}
  function allowed(state,minute,s,signal,mem){
    const hot=signal.hotZones.length>0||signal.emptyHigh,cold=signal.coldZones.length>0||signal.emptyLow;
    return legal(state,minute,s).filter(a=>state.units.every((u,i)=>{
      const target=a.enabled[i]?a.setpointsC[i]:u.setpointC,decline=signal.futureUsed&&signal.futureGroupPeople[i]<signal.currentGroupPeople[i],confirmed=mem.emptyRuns[i]>=s.emptyObservedSlots&&signal.currentGroupPeople[i]===0&&signal.futureGroupPeople[i]===0;
      if(!u.enabled&&a.enabled[i]&&!hot)return false;
      if(u.enabled&&!a.enabled[i]&&!cold&&!decline&&!confirmed)return false;
      if(target<u.setpointC&&!hot)return false;
      if(target>u.setpointC&&!cold&&!decline&&!confirmed)return false;
      return true;
    }));
  }
  function stats(){return {energyKwh:0,maximumOccupiedViolationC:0,hotDegreeMinutes:0,coldDegreeMinutes:0,occupiedDegreeMinutes:0,maximumEmptyViolationC:0,emptyDegreeMinutes:0,occupiedZoneMinutes:0,withinZoneMinutes:0,commandChanges:0};}
  const changes=(state,c)=>sum(state.units.map((u,i)=>Number(u.enabled!==c.enabled[i])+Number(u.setpointC!==c.setpointsC[i])));
  function rank(a,b){const fa=hvacPredictiveModel.isFeasible(a.metrics),fb=hvacPredictiveModel.isFeasible(b.metrics);if(fa!==fb)return fa?-1:1;
    if(!fa)for(const k of ['maximumOccupiedViolationC','occupiedDegreeMinutes','maximumEmptyViolationC','emptyDegreeMinutes']){const d=a.metrics[k]-b.metrics[k];if(Math.abs(d)>1e-8)return d;}
    // With identical evaluated energy and switching objectives, release excess
    // permissions rather than keep an idle machine enabled. No standby saving is invented.
    return a.objectiveKwh-b.objectiveKwh||a.metrics.commandChanges-b.metrics.commandChanges||sum(a.state.units.map(u=>Number(u.enabled)))-sum(b.state.units.map(u=>Number(u.enabled)))||a.sequence.map(c=>c.id).join('/').localeCompare(b.sequence.map(c=>c.id).join('/'));
  }
  function extend(node,action,offset,seconds,pr,pl,s,signal){
    const command=hvacPredictiveModel.commandFor(action,node.state),m={...node.metrics};m.commandChanges+=changes(node.state,command);let state=node.state,time=offset;
    while(time<offset+seconds-1e-8){const until=pr.boundarySeconds-time,dt=Math.min(pl.settings.stepSeconds,offset+seconds-time,until>1e-8?until:Infinity),counts=hvacPredictiveModel.countsAt(pr,time),r=pl.step(state,pr.weather,counts,command,dt);
      hvacPredictiveModel.observe(m,state.temperaturesC,r.state.temperaturesC,counts,dt);m.energyKwh+=r.hvacKwh;state=r.state;time+=dt;}
    m.occupiedDegreeMinutes=m.hotDegreeMinutes+m.coldDegreeMinutes;
    return {state,metrics:m,sequence:[...node.sequence,command],boundaries:[...node.boundaries,{offsetMinutes:(offset+seconds)/60,temperaturesC:[...state.temperaturesC],counts:[...hvacPredictiveModel.countsAt(pr,Math.max(0,offset+seconds-1e-6))],command,signal}],
      switchObjectiveKwh:m.commandChanges*s.switchObjectiveWh/1000,objectiveKwh:m.energyKwh+m.commandChanges*s.switchObjectiveWh/1000};
  }
  function decision(state,record,counts,minute,artifact,pl,mem,input={}){
    const s=settings(input),pr=hvacPredictiveModel.projection(record,artifact,minute,counts,s),rootSignal=probe(state,pr,0,pl,s),rootLegal=legal(state,minute,s),rootAllowed=allowed(state,minute,s,rootSignal,mem);
    let beam=[{state,metrics:stats(),sequence:[],boundaries:[]}],offset=0,generated=0;
    while(offset<pr.durationSeconds-1e-8){const seconds=Math.min(300,pr.durationSeconds-offset),nodes=[];
      for(const n of beam){const signal=offset===0?rootSignal:probe(n.state,pr,offset,pl,s);for(const a of allowed(n.state,minute+offset/60,s,signal,mem)){nodes.push(extend(n,a,offset,seconds,pr,pl,s,signal));generated++;}}
      if(!nodes.length)throw new Error('No legal supervisory continuation');nodes.sort(rank);beam=nodes.slice(0,s.beamWidth);offset+=seconds;
    }
    beam.sort(rank);const best=beam[0],command=best.sequence[0],unitReasons=state.units.map((u,i)=>{
      const changed=u.enabled!==command.enabled[i]||u.setpointC!==command.setpointsC[i],decline=rootSignal.futureUsed&&rootSignal.futureGroupPeople[i]<rootSignal.currentGroupPeople[i],confirmed=mem.emptyRuns[i]>=s.emptyObservedSlots&&rootSignal.currentGroupPeople[i]===0&&rootSignal.futureGroupPeople[i]===0;
      const reasons=[];if(rootSignal.hotZones.length)reasons.push('有人区预计逼近温度上界或已超温');if(rootSignal.coldZones.length)reasons.push('有人区预计逼近温度下界或已过冷');if(decline)reasons.push('本段预测人数下降，候选仍须检查室温');if(confirmed)reasons.push('本段两次不同采样点均为空且下一点未预计有人');
      if(rootSignal.emptyHigh||rootSignal.emptyLow)reasons.push('空区评价边界可能越界');
      const locked=state.elapsedSeconds-u.lastPermissionChange<s.permissionHoldMinutes*60-1e-8||state.elapsedSeconds-u.lastSetpointChange<s.setpointHoldMinutes*60-1e-8;
      return {unit:i,changed,oldEnabled:u.enabled,newEnabled:command.enabled[i],oldSetpointC:u.setpointC,newSetpointC:command.setpointsC[i],reasons:changed?reasons:locked?['维持当前指令，部分调整尚未满足保持时间']:reasons.length?['触发评估，但选中方案保留当前指令',...reasons]:['无有效触发，维持当前指令'],
        observedEmptySlots:mem.emptyRuns[i],crossSegmentSupport:!u.enabled&&command.enabled[i]&&rootSignal.currentGroupPeople[i]===0&&rootSignal.futureGroupPeople[i]===0&&rootSignal.hotZones.length>0};
    });
    return {minute,stateAtDecision:state,observationMemory:mem,projection:pr,signal:rootSignal,command,unitReasons,best,
      search:{beamWidth:s.beamWidth,generatedBlocks:generated,retainedTerminalSequences:beam.length,feasibleTerminalSequences:beam.filter(n=>hvacPredictiveModel.isFeasible(n.metrics)).length,isGlobalOptimal:false},
      rootLegalActions:rootLegal.map(a=>a.id),rootTriggeredActions:rootAllowed.map(a=>a.id),status:hvacPredictiveModel.isFeasible(best.metrics)?'searched_feasible':'searched_no_feasible',
      terminalEquivalentObjectiveKwh:0,terminalObjectiveRemoved:true,
      reason:hvacPredictiveModel.isFeasible(best.metrics)?'触发与保持约束内找到采样可行序列，执行首5分钟':'有限搜索未找到窗口内全程达标序列；在保持约束内选择违规较少方案，保留失败'};
  }
  function runDay(records,artifact,input={}){
    if(!Array.isArray(records)||records.length!==48||records.some((r,i)=>r.slot!==i||r.date!==records[0].date))throw new Error('Complete chronological day required');
    const s=settings(input),pl=hvacResponseModel.plant(s);let state=pl.initial(Array(4).fill(s.initialTemperatureC)),mem=memory(),m=stats(),maxResidual=0;
    const decisions=[],trace=[],unitOnMinutes=[0,0],permissionChanges=[0,0],setpointChanges=[0,0],ledger={storedJ:0,outdoorJ:0,peopleJ:0,lightsJ:0,solarJ:0,mixingJ:0,coolingJ:0,residualJ:0};
    for(let minute=s.startMinute;minute<s.endMinute;minute+=5){const record=records[Math.floor(minute/30)],counts=spatialOccupancyModel.allocate(record.floorReservationProxy,s.pattern);mem=observeSlot(mem,record.slot,counts);
      const d=decision(state,record,counts,minute,artifact,pl,mem,s),c=d.command,before=[...state.temperaturesC],energyBefore=m.energyKwh;m.commandChanges+=changes(state,c);
      for(let u=0;u<2;u++){if(c.enabled[u]!==state.units[u].enabled)permissionChanges[u]++;if(c.setpointsC[u]!==state.units[u].setpointC)setpointChanges[u]++;}
      for(let used=0;used<300-1e-8;){const dt=Math.min(pl.settings.stepSeconds,300-used),r=pl.step(state,record,counts,c,dt);hvacPredictiveModel.observe(m,state.temperaturesC,r.state.temperaturesC,counts,dt);m.energyKwh+=r.hvacKwh;
        for(const k of Object.keys(ledger))ledger[k]+=r.ledger[k];maxResidual=Math.max(maxResidual,r.maximumRegionResidualJ,Math.abs(r.ledger.residualJ));state=r.state;for(let u=0;u<2;u++)if(state.units[u].on)unitOnMinutes[u]+=dt/60;
        if(input.keepTrace!==false)trace.push({minute:minute+(used+dt)/60,counts:[...counts],command:c.id,temperaturesC:[...state.temperaturesC],on:state.units.map(u=>u.on),powerKw:r.powerKw,hvacKwh:r.hvacKwh});used+=dt;
      }
      decisions.push({...d,executedFirstBlock:{initialTemperaturesC:before,finalTemperaturesC:[...state.temperaturesC],energyKwh:m.energyKwh-energyBefore},simulatedFeedback:true});if(typeof input.onDecision==='function')input.onDecision({minute,status:d.status});
    }
    m.occupiedDegreeMinutes=m.hotDegreeMinutes+m.coldDegreeMinutes;
    return {module:'protocol-and-low-frequency',date:records[0].date,settings:s,metrics:m,hvacKwh:m.energyKwh,temperatureCompliancePct:m.occupiedZoneMinutes?100*m.withinZoneMinutes/m.occupiedZoneMinutes:null,
      sampledTemperaturePass:hvacPredictiveModel.isFeasible(m),unitOnMinutes,permissionChanges,setpointChanges,compressorTransitions:state.units.map(u=>u.compressorSwitches),
      finalState:state,finalTemperaturesC:state.temperaturesC,storedChangeKwhThermal:sum(pl.parameters.zones.map((z,i)=>z.capacityJPerK*(state.temperaturesC[i]-s.initialTemperatureC)))/3600000,
      ledger,maxBalanceResidualJ:maxResidual,decisions,trace,savingPct:null,isMeasured:false,usesFutureActual:false,
      note:'仅低频规则验收；两次不同采样点的空置仍是代理，不证明真实无人。未完成三策略公平结算。'};
  }
  return {defaults,settings,memory,observeSlot,probe,legal,allowed,decision,runDay};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=hvacSupervisoryModel;
