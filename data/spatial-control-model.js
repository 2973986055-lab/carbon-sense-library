'use strict';

// Module 3: offline request control on the accepted four-node thermal model.
// No sensor reads or hardware writes. Mean output is an ideal shared thermostat,
// not a command to change a real compressor's frequency.
const spatialControlModel=(()=>{
  const sum=a=>a.reduce((s,x)=>s+x,0),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const ids=['off','west','east','both'];
  const definitions=Object.freeze([
    {id:'fixed',name:'日常基准',description:'运行情景时段两台保留供冷许可，全房间以同一室温目标供冷'},
    {id:'realtime',name:'实时感知情景',description:'当前占用与室温，比较未来5分钟保持当前负荷下的四种供冷许可'},
    {id:'predictive',name:'预测协同情景',description:'下一半小时冻结人数预测，比较30分钟两阶段供冷许可，5分钟后滚动重算'}
  ]);
  function num(v,f,lo,hi,name){const x=v===undefined?f:v;if(typeof x!=='number'||!Number.isFinite(x)||x<lo||x>hi)throw new Error(`Invalid ${name}`);return x;}
  function settings(input={}){
    const s={initialTemperatureC:num(input.initialTemperatureC,24,18,35,'initial indoor temperature'),
      startMinute:num(input.startMinute,390,0,1410,'evaluation start'),endMinute:num(input.endMinute,1350,30,1440,'evaluation end'),
      decisionMinutes:5,predictionHorizonMinutes:30,targetTemperatureC:23.6,occupiedLowerC:23,occupiedUpperC:24,
      emptyLowerC:num(input.emptyLowerC,20,16,23,'empty lower limit'),emptyUpperC:num(input.emptyUpperC,28,24,32,'empty upper limit'),
      minimumOnMinutes:num(input.minimumOnMinutes,5,5,15,'minimum request on'),minimumOffMinutes:num(input.minimumOffMinutes,5,5,15,'minimum request off'),
      switchCostWh:num(input.switchCostWh,0,0,100,'objective switch cost'),
      pattern:input.pattern??'west',forecastMode:input.forecastMode??'frozen'};
    if(s.startMinute%30||s.endMinute%30||s.endMinute<=s.startMinute||s.endMinute-s.startMinute<30)throw new Error('Use a chronological half-hour evaluation window');
    if(![5,10,15].includes(s.minimumOnMinutes)||![5,10,15].includes(s.minimumOffMinutes))throw new Error('Request hold must be 5/10/15 minutes');
    if(!Object.hasOwn(spatialOccupancyModel.patterns,s.pattern)||!['frozen','persistence'].includes(s.forecastMode))throw new Error('Invalid spatial rule or prediction mode');
    return s;
  }
  const occupancyMask=counts=>counts.reduce((mask,n,i)=>mask|(n>0?1<<i:0),0);
  const switched=(a,b)=>Number((a&1)!==(b&1))+Number((a&2)!==(b&2));
  function memory(){return {mask:0,lastChange:[-Infinity,-Infinity]};}
  function allowed(state,minute,s){
    return [0,1,2,3].filter(mask=>[0,1].every(i=>{
      const on=Boolean(state.mask&(1<<i)),next=Boolean(mask&(1<<i));
      if(next&&(minute<s.startMinute||minute>=s.endMinute))return false;
      if(on===next)return true;
      if(minute-state.lastChange[i]<(on?s.minimumOnMinutes:s.minimumOffMinutes)-1e-8)return false;
      return !next||minute+s.minimumOnMinutes<=s.endMinute;
    }));
  }
  function transition(state,mask,minute){const next={mask,lastChange:[...state.lastChange]};for(let i=0;i<2;i++)if(Boolean(mask&(1<<i))!==Boolean(state.mask&(1<<i)))next.lastChange[i]=minute;return next;}
  function plant(input={}){
    const s=settings(input),p=spatialThermalModel.parameters({...input,timeStepSeconds:60}),zero={outdoorTemperatureC:0,southVerticalIrradianceWm2:0},counts=[0,0,0,0],temps=[0,0,0,0];
    const base=spatialThermalModel.step(temps,zero,counts,'off',0,p).temperaturesC;
    const columns=temps.map((_,j)=>{const v=[0,0,0,0];v[j]=1;return spatialThermalModel.step(v,zero,counts,'off',0,p).temperaturesC.map((t,i)=>t-base[i]);});
    const response=[1,2].map(mask=>spatialThermalModel.step(temps,zero,counts,ids[mask],1,p).temperaturesC.map((t,i)=>base[i]-t));
    const cache=new Map();
    function forcing(record,people){const key=[record.outdoorTemperatureC,record.southVerticalIrradianceWm2,...people].join('/');if(!cache.has(key))cache.set(key,spatialThermalModel.step(temps,record,people,'off',0,p).temperaturesC);return cache.get(key);}
    function advance(before,record,people,mask,serviceMask,includeLedger=false){
      const offset=forcing(record,people),free=offset.map((b,i)=>b+sum(columns.map((c,j)=>c[i]*before[j]))),r=free.map((_,i)=>sum(response.map((rs,j)=>mask&(1<<j)?rs[i]:0)));
      const actuallyOccupied=occupancyMask(people),served=serviceMask;
      let demand=0,limit=1;
      for(let i=0;i<4;i++)if(r[i]>1e-12){
        const target=served&(1<<i)?s.targetTemperatureC:s.emptyUpperC;
        const lower=(actuallyOccupied|(served===15?15:0))&(1<<i)?s.occupiedLowerC:s.emptyLowerC;
        demand=Math.max(demand,(free[i]-target)/r[i]);limit=Math.min(limit,(free[i]-lower)/r[i]);
      }
      // Limit delivered cooling, never overwrite/clamp the resulting temperature.
      const fraction=mask?clamp(Math.min(demand,limit),0,1):0,after=free.map((t,i)=>t-r[i]*fraction),ac=spatialThermalModel.cooling(ids[mask],fraction,p);
      const result={temperaturesC:after,freeTemperaturesC:free,fraction,requestMask:mask,...ac,hvacKwh:ac.hvacInputKw/60};
      if(includeLedger){
        const loads=spatialThermalModel.gains(record,people,p),mix=[0,0,0,0];
        for(const {i,j,conductanceWPerK:k} of p.links){const q=k*(after[j]-after[i]);mix[i]+=q;mix[j]-=q;}
        const storage=p.zones.map((z,i)=>z.capacityJPerK*(after[i]-before[i])),outdoor=p.zones.map((z,i)=>z.outdoorConductanceWPerK*(record.outdoorTemperatureC-after[i]));
        const ledger={peopleJ:sum(loads.map(x=>x.peopleW))*60,lightsJ:sum(loads.map(x=>x.lightsW))*60,solarJ:sum(loads.map(x=>x.solarW))*60,
          outdoorJ:sum(outdoor)*60,coolingJ:sum(ac.zoneCoolingW)*60,mixingJ:sum(mix)*60,storedJ:sum(storage)};
        ledger.residualJ=ledger.storedJ-(ledger.peopleJ+ledger.lightsJ+ledger.solarJ+ledger.outdoorJ-ledger.coolingJ);
        result.ledger=ledger;result.maxRegionResidualJ=Math.max(...p.zones.map((z,i)=>Math.abs(storage[i]-(loads[i].peopleW+loads[i].lightsW+loads[i].solarW+outdoor[i]+mix[i]-ac.zoneCoolingW[i])*60)));
      }
      return result;
    }
    return {settings:s,parameters:p,advance};
  }
  function comfort(before,after,counts,s){
    let maxViolationC=0,degreeMinutes=0,emptyViolationC=0,emptyDegreeMinutes=0,occupiedZones=0,withinZones=0;
    for(let i=0;i<4;i++){
      const occupied=counts[i]>0,low=occupied?s.occupiedLowerC:s.emptyLowerC,high=occupied?s.occupiedUpperC:s.emptyUpperC;
      const a=Math.max(0,low-before[i],before[i]-high),b=Math.max(0,low-after[i],after[i]-high);
      if(occupied){occupiedZones++;maxViolationC=Math.max(maxViolationC,a,b);degreeMinutes+=(a+b)/2;if(a<1e-7&&b<1e-7)withinZones++;}
      else {emptyViolationC=Math.max(emptyViolationC,a,b);emptyDegreeMinutes+=(a+b)/2;}
    }
    return {maxViolationC,degreeMinutes,emptyViolationC,emptyDegreeMinutes,occupiedZones,withinZones};
  }
  function projection(record,artifact,minute,counts,pl,horizon,forecastMode){
    const s=pl.settings,remaining=30-minute%30;
    const predicted=record.slot<47&&forecastMode==='frozen'?reservationModel.transfer(artifact,record.slot,sum(counts)).people:sum(counts);
    const next=spatialOccupancyModel.allocate(predicted,s.pattern);
    const steps=Array.from({length:horizon},(_,k)=>{
      const open=minute+k>=s.startMinute&&minute+k<s.endMinute;
      return {record,counts:open?(k<remaining?counts:next):[0,0,0,0],open};
    });
    return {steps,currentPeople:sum(counts),predictedPeople:predicted,currentCounts:[...counts],predictedCounts:[...next],nextBoundaryMinute:minute+remaining,
      weatherMode:'起点天气保持不变',forecastMode,usesFutureActual:false};
  }
  function rollout(before,first,second,state,minute,pr,pl){
    let t=[...before],energyKwh=0,maxViolationC=0,degreeMinutes=0,emptyViolationC=0,emptyDegreeMinutes=0;
    const s=pl.settings;
    for(let k=0;k<pr.steps.length;k++){
      const step=pr.steps[k],mask=step.open?(k<s.decisionMinutes?first:second):0,served=occupancyMask(step.counts);
      const r=pl.advance(t,step.record,step.counts,mask,served),c=comfort(t,r.temperaturesC,step.counts,s);t=r.temperaturesC;energyKwh+=r.hvacKwh;
      maxViolationC=Math.max(maxViolationC,c.maxViolationC);degreeMinutes+=c.degreeMinutes;emptyViolationC=Math.max(emptyViolationC,c.emptyViolationC);emptyDegreeMinutes+=c.emptyDegreeMinutes;
    }
    const last=pr.steps.at(-1).counts,active=occupancyMask(last),cop=pl.parameters.ratedSensibleWPerUnit/1000/pl.parameters.ratedInputKwPerUnit;
    const terminalEquivalentKwh=sum(pl.parameters.zones.map((z,i)=>active&(1<<i)?z.capacityJPerK*Math.max(0,t[i]-s.targetTemperatureC)/3600000/cop:0));
    const changes=switched(state.mask,first)+(pr.steps.length>s.decisionMinutes?switched(first,second):0);
    return {firstMask:first,secondMask:second,finalTemperaturesC:t,energyKwh,terminalEquivalentKwh,switchObjectiveKwh:changes*s.switchCostWh/1000,
      objectiveKwh:energyKwh+terminalEquivalentKwh+changes*s.switchCostWh/1000,maxViolationC,degreeMinutes,emptyViolationC,emptyDegreeMinutes};
  }
  function scoreCompare(a,b){
    for(const key of ['maxViolationC','degreeMinutes','emptyViolationC','emptyDegreeMinutes','objectiveKwh']){
      const d=a[key]-b[key];if(Math.abs(d)>(key.includes('Violation')?1e-7:1e-8))return d;
    }
    return a.firstMask-b.firstMask||a.secondMask-b.secondMask;
  }
  function decision(policy,before,record,counts,minute,state,pl,artifact){
    if(!definitions.some(d=>d.id===policy))throw new Error('Unknown spatial policy');
    const s=pl.settings,valid=allowed(state,minute,s);
    if(!valid.length)throw new Error('No valid request state');
    if(policy==='fixed'){
      const wanted=minute>=s.startMinute&&minute<s.endMinute?3:0;
      const mask=valid.includes(wanted)?wanted:valid.slice().sort((a,b)=>switched(a,wanted)-switched(b,wanted))[0];
      return {mask,projection:null,candidates:[],reason:'日常两台许可，服务全房间；内部平均供冷使用同一响应模型'};
    }
    const horizon=policy==='predictive'?30:5,forecastMode=policy==='predictive'?s.forecastMode:'persistence';
    const pr=projection(record,artifact,minute,counts,pl,horizon,forecastMode),candidates=[];
    for(const first of valid){
      const nextState=transition(state,first,minute),tail=horizon>5?allowed(nextState,minute+5,s):[first];
      for(const second of tail)candidates.push(rollout(before,first,second,state,minute,pr,pl));
    }
    candidates.sort(scoreCompare);const best=candidates[0];
    return {mask:best.firstMask,projection:pr,candidates,best,
      reason:best.maxViolationC>1e-6?'候选均含有人区超限；选择越界最少方案，不声称达标':policy==='predictive'?'先比较室温约束，再比较耗电与末端热量目标项，执行前5分钟':'当前负荷保持5分钟，先比较室温约束，再比较耗电'};
  }
  function validateRecords(records){
    if(!Array.isArray(records)||records.length!==48)throw new Error('Expected one complete 48-slot historical day');
    for(let i=0;i<48;i++){const r=records[i];if(!r||r.slot!==i||r.date!==records[0].date||!Number.isInteger(r.floorReservationProxy)||r.floorReservationProxy<0||r.floorReservationProxy>314)throw new Error('Invalid chronological demand day');}
  }
  function runPolicy(records,artifact,policy,pl){
    const s=pl.settings,initial=[s.initialTemperatureC,s.initialTemperatureC,s.initialTemperatureC,s.initialTemperatureC];
    let temperatures=[...initial],state=memory(),energyKwh=0,occupiedZoneMinutes=0,withinRangeZoneMinutes=0,maxViolationC=0,degreeMinutes=0,emptyViolationC=0,maxResidualJ=0;
    const trace=[],decisions=[],ledger={peopleJ:0,lightsJ:0,solarJ:0,outdoorJ:0,coolingJ:0,mixingJ:0,storedJ:0,residualJ:0},unitRequestMinutes=[0,0],unitCoolingMinutes=[0,0],unitSwitches=[0,0];
    let lastDecision=null;
    for(let minute=s.startMinute;minute<s.endMinute;minute++){
      const r=records[Math.floor(minute/30)],counts=spatialOccupancyModel.allocate(r.floorReservationProxy,s.pattern);
      if((minute-s.startMinute)%s.decisionMinutes===0){
        lastDecision=decision(policy,temperatures,r,counts,minute,state,pl,artifact);
        const next=transition(state,lastDecision.mask,minute);for(let i=0;i<2;i++)if(state.lastChange[i]!==next.lastChange[i])unitSwitches[i]++;
        state=next;decisions.push({minute,mask:state.mask,reason:lastDecision.reason,
          currentCounts:[...counts],predictedCounts:lastDecision.projection?.predictedCounts??null,predictedPeople:lastDecision.projection?.predictedPeople??null,
          candidateSummary:lastDecision.candidates.map(c=>({firstMask:c.firstMask,secondMask:c.secondMask,energyKwh:c.energyKwh,terminalEquivalentKwh:c.terminalEquivalentKwh,objectiveKwh:c.objectiveKwh,maxViolationC:c.maxViolationC,degreeMinutes:c.degreeMinutes})),
          best:lastDecision.best??null});
      }
      const served=policy==='fixed'?15:occupancyMask(counts),before=[...temperatures],result=pl.advance(before,r,counts,state.mask,served,true),c=comfort(before,result.temperaturesC,counts,s);
      temperatures=result.temperaturesC;energyKwh+=result.hvacKwh;occupiedZoneMinutes+=c.occupiedZones;withinRangeZoneMinutes+=c.withinZones;
      maxViolationC=Math.max(maxViolationC,c.maxViolationC);degreeMinutes+=c.degreeMinutes;emptyViolationC=Math.max(emptyViolationC,c.emptyViolationC);
      maxResidualJ=Math.max(maxResidualJ,Math.abs(result.ledger.residualJ),result.maxRegionResidualJ);
      for(const key of Object.keys(ledger))ledger[key]+=result.ledger[key];
      for(let i=0;i<2;i++){if(state.mask&(1<<i))unitRequestMinutes[i]++;if(result.unitCoolingW[i]>1e-7)unitCoolingMinutes[i]++;}
      trace.push({minute,slot:r.slot,people:r.floorReservationProxy,counts:[...counts],requestMask:state.mask,meanCoolingFraction:result.fraction,
        temperaturesBeforeC:before,temperaturesC:[...temperatures],zoneCoolingW:[...result.zoneCoolingW],hvacKw:result.hvacInputKw,hvacKwh:result.hvacKwh,
        violationC:c.maxViolationC,degreeMinutes:c.degreeMinutes,balanceResidualJ:result.ledger.residualJ});
    }
    const stop=transition(state,0,s.endMinute);for(let i=0;i<2;i++)if(stop.lastChange[i]!==state.lastChange[i])unitSwitches[i]++;
    if(!allowed(state,s.endMinute,s).includes(0))throw new Error('Scheduled shutdown conflicts with request hold');
    const storageByZoneKwh=pl.parameters.zones.map((z,i)=>z.capacityJPerK*(temperatures[i]-initial[i])/3600000);
    return {id:policy,name:definitions.find(d=>d.id===policy).name,hvacKwh:energyKwh,lightingKwh:pl.parameters.lightingTotalW/1000*(s.endMinute-s.startMinute)/60,
      initialTemperaturesC:initial,finalTemperaturesC:[...temperatures],storedChangeKwhThermal:sum(storageByZoneKwh),storageByZoneKwh,
      occupiedZoneMinutes,withinRangeZoneMinutes,temperatureCompliancePct:occupiedZoneMinutes?withinRangeZoneMinutes/occupiedZoneMinutes*100:null,
      maximumOccupiedViolationC:maxViolationC,occupiedViolationDegreeMinutes:degreeMinutes,maximumEmptyViolationC:emptyViolationC,
      unitRequestMinutes,unitCoolingMinutes,unitSwitches,shutdownMask:0,trace,decisions,ledger,maxBalanceResidualJ:maxResidualJ,
      outsideAssumedOperatingRange:trace.some(t=>t.temperaturesC.some(v=>v<16||v>40)),isMeasured:false};
  }
  function simulateDay(records,artifact,input={}){
    validateRecords(records);const pl=plant(input),s=pl.settings,modes=definitions.map(d=>runPolicy(records,artifact,d.id,pl)),base=modes[0],cop=pl.parameters.ratedSensibleWPerUnit/1000/pl.parameters.ratedInputKwPerUnit;
    for(const m of modes){
      m.energyKwh=m.hvacKwh+m.lightingKwh;m.hvacDifferenceFromBaselineKwh=base.hvacKwh-m.hvacKwh;
      m.terminalHeatDifferenceKwhThermal=m.storedChangeKwhThermal-base.storedChangeKwhThermal;
      m.terminalEquivalentDifferenceKwh=m.terminalHeatDifferenceKwhThermal/cop;
      m.terminalAdjustedDifferenceKwh=m.hvacDifferenceFromBaselineKwh-m.terminalEquivalentDifferenceKwh;
      m.maximumTerminalTemperatureDifferenceC=Math.max(...m.finalTemperaturesC.map((t,i)=>Math.abs(t-base.finalTemperaturesC[i])));
      m.fairSavingEligible=!base.outsideAssumedOperatingRange&&!m.outsideAssumedOperatingRange&&base.maximumOccupiedViolationC<1e-6&&m.maximumOccupiedViolationC<1e-6&&base.maximumEmptyViolationC<1e-6&&m.maximumEmptyViolationC<1e-6&&m.maximumTerminalTemperatureDifferenceC<=.05;
      m.savingPct=m.fairSavingEligible&&base.hvacKwh>0?m.hvacDifferenceFromBaselineKwh/base.hvacKwh*100:null;
      m.comparisonNote=m.fairSavingEligible?'在本情景采样室温和末温可比条件下的耗电差，仍非实测节电':
        '保留原始耗电差；有人/空区约束或末端状态未共同满足，不标注已满足约束的节电率';
    }
    return {version:1,module:'spatial-request-control',date:records[0].date,settings:s,parameters:pl.parameters,modes,
      forecastScope:'冻结五训二验总人数预测；分区按同一假设规则分配。室温为模型状态，天气为网格再分析；控制器不读取未来实际需求或天气。',
      actuatorScope:'每5分钟选择两台供冷许可组合；每分钟共用同一理想室温反馈/供冷上限/低温保护。平均供冷非真实频率指令，许可保持不等同压缩机启停日志。',
      operationScope:`${s.startMinute/60}—${s.endMinute/60}为人工评估时段；初温为共同假设，不模拟提前开馆预冷。日常服务全房间，优化策略有人23—24℃、空区${s.emptyLowerC}—${s.emptyUpperC}℃是假设。`,
      methodScope:'预测采用有限两阶段候选模拟，非全局最优MPC；未来计划只执行前5分钟。切换成本和末端热量校正仅为目标/指标，未计入实际耗电。',
      noPublishedOrHardwareAction:true};
  }
  function ablation(records,artifact,input={}){
    validateRecords(records);const pl=plant({...input,forecastMode:'persistence'}),m=runPolicy(records,artifact,'predictive',pl);
    return {...m,name:'同一预测控制器＋人数保持不变',scope:'只移除冻结人数预测；30分钟规划、分区规则、执行器和所有约束相同。用于分离预测增量与滚动控制增量。'};
  }
  function sensitivity(records,artifact,input={}){
    const cases=[];
    for(const mixingWPerK of [300,1000,3000,5000])for(const ownSegmentShare of [.5,.7,.85]){
      const r=simulateDay(records,artifact,{...input,mixingWPerK,ownSegmentShare});
      cases.push({mixingWPerK,ownSegmentShare,modes:r.modes.map(m=>({id:m.id,hvacKwh:m.hvacKwh,temperatureCompliancePct:m.temperatureCompliancePct,
        maximumOccupiedViolationC:m.maximumOccupiedViolationC,occupiedViolationDegreeMinutes:m.occupiedViolationDegreeMinutes,storedChangeKwhThermal:m.storedChangeKwhThermal,
        terminalAdjustedDifferenceKwh:m.terminalAdjustedDifferenceKwh,maximumTerminalTemperatureDifferenceC:m.maximumTerminalTemperatureDifferenceC,savingPct:m.savingPct,unitSwitches:m.unitSwitches}))});
    }
    return {caseCount:cases.length,cases,note:'4种混合强度×3种供冷方向性，共12个未校准情景；3000/5000W/K为额外强混合诊断，不是实测或拟合结果。未覆盖全部参数，不是置信区间，不自动挑选参数作为最终结论。'};
  }
  return {definitions,ids,settings,occupancyMask,memory,allowed,transition,plant,comfort,projection,decision,simulateDay,ablation,sensitivity};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=spatialControlModel;
