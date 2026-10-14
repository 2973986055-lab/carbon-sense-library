'use strict';

// Module 3 revision: two independently allocated mean cooling outputs.
// Geometry/loads stay unchanged. Airflow and fan power are UNKNOWN, not fitted.
const spatialControlOptimized=(()=>{
  const sum=a=>a.reduce((s,v)=>s+v,0),clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const definitions=spatialControlModel.definitions;
  const options=Object.freeze([{mask:0,target:23.6},...[1,2,3].flatMap(mask=>[{mask,target:23.6},{mask,target:23.9}])]);
  function settings(input={}){
    const old=spatialControlModel.settings(input);
    const val=(v,f,min,max,name)=>{const x=v??f;if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max)throw new Error('Invalid '+name);return x;};
    return {...old,minimumOnMinutes:input.minimumOnMinutes??10,minimumOffMinutes:input.minimumOffMinutes??10,
      reserveTargetC:23.6,economyTargetC:val(input.economyTargetC,23.9,23.6,23.9,'economy temperature'),switchObjectiveWh:val(input.switchObjectiveWh,20,0,100,'switch objective'),
      allowedExtraViolationC:.000001,restorationMinutes:30,
      indoorFanKw:val(input.indoorFanKw,0,0,1,'fan power sensitivity'),startupWh:val(input.startupWh,0,0,100,'startup sensitivity'),
      fanPowerVerified:false,airflowM3h:null};
  }
  function plant(input={}){
    const s=settings(input),legacy=spatialControlModel.plant({...input,minimumOnMinutes:s.minimumOnMinutes,minimumOffMinutes:s.minimumOffMinutes}),p=legacy.parameters;
    const zero={outdoorTemperatureC:0,southVerticalIrradianceWm2:0},counts=[0,0,0,0],t0=[0,0,0,0],base=spatialThermalModel.step(t0,zero,counts,'off',0,p).temperaturesC;
    const columns=t0.map((_,j)=>{const v=[0,0,0,0];v[j]=1;return spatialThermalModel.step(v,zero,counts,'off',0,p).temperaturesC.map((t,i)=>t-base[i]);});
    const response=['west','east'].map(id=>spatialThermalModel.step(t0,zero,counts,id,1,p).temperaturesC.map((t,i)=>base[i]-t)),cache=new Map();
    function free(before,record,people){const key=[record.outdoorTemperatureC,record.southVerticalIrradianceWm2,...people].join('/');if(!cache.has(key))cache.set(key,spatialThermalModel.step(t0,record,people,'off',0,p).temperaturesC);return cache.get(key).map((v,i)=>v+sum(columns.map((c,j)=>c[i]*before[j])));}
    const unitPower=(fraction,on)=>on?s.indoorFanKw+(p.ratedInputKwPerUnit-s.indoorFanKw)*fraction/(1-p.settings.cyclingCoefficient+p.settings.cyclingCoefficient*fraction):0;
    function solve(freeT,mask,serviceMask,people,target){
      // Polygon of independent west/east output fractions within 0..1.
      // Upper and lower temperature constraints are linear in cooling outputs.
      const upper=freeT.map((_,i)=>serviceMask&(1<<i)?target:s.emptyUpperC),lower=freeT.map((_,i)=>people[i]>0||serviceMask===15?s.occupiedLowerC:s.emptyLowerC);
      let polygon=[[0,0],[mask&1?1:0,0],[mask&1?1:0,mask&2?1:0],[0,mask&2?1:0]];
      function clip(poly,a,b,c){const out=[];for(let i=0;i<poly.length;i++){const v=poly[i],w=poly[(i+1)%poly.length],fv=a*v[0]+b*v[1]-c,fw=a*w[0]+b*w[1]-c;
        if(fv<=1e-10)out.push(v);if((fv>1e-10)!==(fw>1e-10)){const ratio=fv/(fv-fw);out.push([v[0]+ratio*(w[0]-v[0]),v[1]+ratio*(w[1]-v[1])]);}}
        return out;}
      // Lower guards apply even if the selected target cannot be reached.
      for(let i=0;i<4;i++)polygon=clip(polygon,response[0][i],response[1][i],Math.max(0,freeT[i]-lower[i]));
      const safePolygon=polygon.map(v=>[...v]);
      for(let i=0;i<4;i++)polygon=clip(polygon,-response[0][i],-response[1][i],upper[i]-freeT[i]);
      function score(v){const after=freeT.map((t,i)=>t-response[0][i]*v[0]-response[1][i]*v[1]);
        const violations=after.map((t,i)=>people[i]>0?Math.max(0,23-t,t-24):0),empty=after.map((t,i)=>people[i]===0?Math.max(0,s.emptyLowerC-t,t-s.emptyUpperC):0);
        const targetExcess=after.map((t,i)=>Math.max(0,t-upper[i]));
        return {fractions:v,after,maxViolation:Math.max(...violations),violationSum:sum(violations),targetExcess:Math.max(...targetExcess),targetExcessSum:sum(targetExcess),emptyViolation:Math.max(...empty),kw:unitPower(v[0],Boolean(mask&1))+unitPower(v[1],Boolean(mask&2))};}
      // The generic PLF power is concave, so its constrained minimum occurs at
      // a polygon vertex. No manufacturer performance optimality is claimed.
      let comfortPolygon=safePolygon.map(v=>[...v]);
      for(let i=0;i<4;i++)comfortPolygon=clip(comfortPolygon,-response[0][i],-response[1][i],(serviceMask&(1<<i)?24:s.emptyUpperC)-freeT[i]);
      const candidates=polygon.length?polygon:comfortPolygon.length?comfortPolygon:safePolygon;
      if(!candidates.length)candidates.push([0,0]);
      return candidates.map(score).sort((a,b)=>polygon.length?a.kw-b.kw:
        a.maxViolation-b.maxViolation||a.violationSum-b.violationSum||a.targetExcess-b.targetExcess||a.targetExcessSum-b.targetExcessSum||a.emptyViolation-b.emptyViolation||a.kw-b.kw)[0];
    }
    function advance(before,record,people,mask,serviceMask,target=23.6,includeLedger=false){
      const freeT=free(before,record,people),chosen=solve(freeT,mask,serviceMask,people,target),fractions=chosen.fractions.map((f,i)=>mask&(1<<i)?clamp(f,0,1):0);
      const unitCoolingW=fractions.map(f=>f*p.ratedSensibleWPerUnit),unitInputKw=fractions.map((f,i)=>unitPower(f,Boolean(mask&(1<<i))));
      const zoneCoolingW=p.zones.map((_,i)=>sum(unitCoolingW.map((q,j)=>q*p.coolingShares[j][i]))),after=freeT.map((t,i)=>t-sum(response.map((r,j)=>r[i]*fractions[j])));
      const result={temperaturesC:after,fractions,unitCoolingW,unitInputKw,zoneCoolingW,hvacKw:sum(unitInputKw),hvacKwh:sum(unitInputKw)/60,
        requestMask:mask,targetTemperatureC:target};
      if(includeLedger){const loads=spatialThermalModel.gains(record,people,p),mix=[0,0,0,0];for(const {i,j,conductanceWPerK:k} of p.links){const q=k*(after[j]-after[i]);mix[i]+=q;mix[j]-=q;}
        const stored=p.zones.map((z,i)=>z.capacityJPerK*(after[i]-before[i])),outside=p.zones.map((z,i)=>z.outdoorConductanceWPerK*(record.outdoorTemperatureC-after[i]));
        result.ledger={peopleJ:sum(loads.map(x=>x.peopleW))*60,lightsJ:sum(loads.map(x=>x.lightsW))*60,solarJ:sum(loads.map(x=>x.solarW))*60,
          outdoorJ:sum(outside)*60,coolingJ:sum(zoneCoolingW)*60,mixingJ:sum(mix)*60,storedJ:sum(stored)};
        const l=result.ledger;l.residualJ=l.storedJ-(l.peopleJ+l.lightsJ+l.solarJ+l.outdoorJ-l.coolingJ);
        result.maxRegionResidualJ=Math.max(...p.zones.map((z,i)=>Math.abs(stored[i]-(loads[i].peopleW+loads[i].lightsW+loads[i].solarW+outside[i]+mix[i]-zoneCoolingW[i])*60)));
      }
      return result;
    }
    return {settings:s,parameters:p,advance,free,response,solve};
  }
  const allowed=(state,minute,s)=>spatialControlModel.allowed(state,minute,s);
  const bitsChanged=(a,b)=>Number((a&1)!==(b&1))+Number((a&2)!==(b&2));
  function rollout(before,first,tail,state,minute,projection,pl){
    let t=[...before],energy=0,violation=0,degree=0,empty=0,emptyDegree=0;const s=pl.settings;
    for(let k=0;k<projection.steps.length;k++){
      const step=projection.steps[k],action=k<5?first:tail,mask=step.open?action.mask:0;
      const restoring=minute+k>=s.endMinute-s.restorationMinutes,target=restoring?s.reserveTargetC:action.target;
      const r=pl.advance(t,step.record,step.counts,mask,restoring?15:spatialControlModel.occupancyMask(step.counts),target),c=spatialControlModel.comfort(t,r.temperaturesC,step.counts,s);
      t=r.temperaturesC;energy+=r.hvacKwh;violation=Math.max(violation,c.maxViolationC);degree+=c.degreeMinutes;empty=Math.max(empty,c.emptyViolationC);emptyDegree+=c.emptyDegreeMinutes;
    }
    const coolingDebt=sum(pl.parameters.zones.map((z,i)=>z.capacityJPerK*Math.max(0,t[i]-23.9)/3600000))/(pl.parameters.ratedSensibleWPerUnit/1000/pl.parameters.ratedInputKwPerUnit);
    const transitions=bitsChanged(state.mask,first.mask)+(projection.steps.length>5?bitsChanged(first.mask,tail.mask):0);
    return {first,tail,energyKwh:energy,maximumViolationC:violation,degreeMinutes:degree,emptyViolationC:empty,emptyDegreeMinutes:emptyDegree,
      terminalObjectiveKwh:coolingDebt,switchObjectiveKwh:transitions*s.switchObjectiveWh/1000,
      objectiveKwh:energy+coolingDebt+transitions*s.switchObjectiveWh/1000,finalTemperaturesC:t};
  }
  function compare(a,b){for(const key of ['maximumViolationC','degreeMinutes','emptyViolationC','emptyDegreeMinutes','objectiveKwh']){const diff=a[key]-b[key];if(Math.abs(diff)>1e-7)return diff;}return a.first.mask-b.first.mask||a.first.target-b.first.target;}
  function decision(policy,before,record,people,minute,state,pl,artifact){
    const s=pl.settings,valid=allowed(state,minute,s),restoring=minute>=s.endMinute-s.restorationMinutes;
    if(policy==='fixed'||restoring){const wanted=3,mask=valid.includes(wanted)?wanted:valid.slice().sort((a,b)=>bitsChanged(a,wanted)-bitsChanged(b,wanted))[0];return {action:{mask,target:23.6},candidates:[],projection:null,restoring};}
    const horizon=policy==='predictive'?30:5,projection=spatialControlModel.projection(record,artifact,minute,people,pl,horizon,policy==='predictive'?s.forecastMode:'persistence');
    const available=options.map(a=>({...a,target:a.target===23.9?s.economyTargetC:a.target}));
    const actions=available.filter(a=>valid.includes(a.mask)),candidates=[];
    for(const first of actions){const next=spatialControlModel.transition(state,first.mask,minute),allowedTail=horizon>5?allowed(next,minute+5,s):[first.mask];
      const tails=horizon>5?available.filter(a=>allowedTail.includes(a.mask)):[first];for(const tail of tails)candidates.push(rollout(before,first,tail,state,minute,projection,pl));}
    candidates.sort(compare);return {action:candidates[0].first,best:candidates[0],candidates,projection,restoring};
  }
  function runPolicy(records,artifact,policy,pl){
    const s=pl.settings;let temps=Array(4).fill(s.initialTemperatureC),state=spatialControlModel.memory(),action={mask:0,target:23.6},hvacKwh=0,startupKwh=0;
    const initial=[...temps],trace=[],decisions=[],unitSwitches=[0,0],unitRequestMinutes=[0,0],ledger={peopleJ:0,lightsJ:0,solarJ:0,outdoorJ:0,coolingJ:0,mixingJ:0,storedJ:0,residualJ:0};
    let occupied=0,within=0,violation=0,degree=0,empty=0,residual=0;
    for(let minute=s.startMinute;minute<s.endMinute;minute++){
      const r=records[Math.floor(minute/30)],counts=spatialOccupancyModel.allocate(r.floorReservationProxy,s.pattern);
      if((minute-s.startMinute)%5===0){const d=decision(policy,temps,r,counts,minute,state,pl,artifact),next=spatialControlModel.transition(state,d.action.mask,minute);for(let i=0;i<2;i++)if(next.lastChange[i]!==state.lastChange[i]){unitSwitches[i]++;if(next.mask&(1<<i))startupKwh+=s.startupWh/1000;}
        state=next;action=d.action;decisions.push({minute,...action,restoring:d.restoring,currentCounts:[...counts],predictedPeople:d.projection?.predictedPeople??null,predictedCounts:d.projection?.predictedCounts??null,
          reason:d.restoring?'最后30分钟共同恢复，恢复电耗计入':policy==='fixed'?'两台许可并服务全房间，使用同一独立输出分配器':d.best.maximumViolationC>1e-6?'候选有人区均存在超限，保留失败':'共同23—24℃边界内选择许可和23.6/23.9℃室温目标',
          best:d.best??null,candidateSummary:d.candidates.slice(0,20).map(c=>({firstMask:c.first.mask,secondMask:c.tail.mask,firstTarget:c.first.target,secondTarget:c.tail.target,energyKwh:c.energyKwh,terminalEquivalentKwh:c.terminalObjectiveKwh,objectiveKwh:c.objectiveKwh,maxViolationC:c.maximumViolationC,degreeMinutes:c.degreeMinutes}))});}
      const restoring=minute>=s.endMinute-s.restorationMinutes,served=policy==='fixed'||restoring?15:spatialControlModel.occupancyMask(counts),before=[...temps],res=pl.advance(before,r,counts,state.mask,served,action.target,true),c=spatialControlModel.comfort(before,res.temperaturesC,counts,s);
      temps=res.temperaturesC;hvacKwh+=res.hvacKwh;occupied+=c.occupiedZones;within+=c.withinZones;violation=Math.max(violation,c.maxViolationC);degree+=c.degreeMinutes;empty=Math.max(empty,c.emptyViolationC);residual=Math.max(residual,Math.abs(res.ledger.residualJ),res.maxRegionResidualJ);
      for(const k of Object.keys(ledger))ledger[k]+=res.ledger[k];for(let i=0;i<2;i++)if(state.mask&(1<<i))unitRequestMinutes[i]++;
      trace.push({minute,counts,requestMask:state.mask,targetTemperatureC:action.target,meanCoolingFractions:[...res.fractions],temperaturesBeforeC:before,temperaturesC:[...temps],hvacKw:res.hvacKw,hvacKwh:res.hvacKwh,zoneCoolingW:res.zoneCoolingW,violationC:c.maxViolationC});
    }
    if(!allowed(state,s.endMinute,s).includes(0))throw new Error('Shutdown hold violation');for(let i=0;i<2;i++)if(state.mask&(1<<i))unitSwitches[i]++;
    return {id:policy,name:definitions.find(d=>d.id===policy).name,hvacKwh:hvacKwh+startupKwh,coolingAndFanKwh:hvacKwh,startupSensitivityKwh:startupKwh,lightingKwh:pl.parameters.lightingTotalW/1000*(s.endMinute-s.startMinute)/60,
      initialTemperaturesC:initial,finalTemperaturesC:[...temps],storedChangeKwhThermal:sum(pl.parameters.zones.map((z,i)=>z.capacityJPerK*(temps[i]-initial[i])))/3600000,
      temperatureCompliancePct:occupied?within/occupied*100:null,maximumOccupiedViolationC:violation,occupiedViolationDegreeMinutes:degree,maximumEmptyViolationC:empty,
      unitSwitches,unitRequestMinutes,trace,decisions,ledger,maxBalanceResidualJ:residual,isMeasured:false};
  }
  function simulateDay(records,artifact,input={}){
    if(!Array.isArray(records)||records.length!==48||records.some((r,i)=>r.slot!==i||r.date!==records[0].date))throw new Error('Expected complete chronological day');
    const pl=plant(input),modes=definitions.map(d=>runPolicy(records,artifact,d.id,pl)),base=modes[0];
    for(const m of modes){m.energyKwh=m.hvacKwh+m.lightingKwh;m.hvacDifferenceFromBaselineKwh=base.hvacKwh-m.hvacKwh;m.maximumTerminalTemperatureDifferenceC=Math.max(...m.finalTemperaturesC.map((t,i)=>Math.abs(t-base.finalTemperaturesC[i])));
      m.terminalHeatDifferenceKwhThermal=m.storedChangeKwhThermal-base.storedChangeKwhThermal;
      m.terminalEquivalentDifferenceKwh=m.terminalHeatDifferenceKwhThermal/(pl.parameters.ratedSensibleWPerUnit/1000/pl.parameters.ratedInputKwPerUnit);
      m.terminalAdjustedDifferenceKwh=m.hvacDifferenceFromBaselineKwh-m.terminalEquivalentDifferenceKwh;
      m.fairSavingEligible=base.maximumOccupiedViolationC<1e-6&&m.maximumOccupiedViolationC<1e-6&&base.maximumEmptyViolationC<1e-6&&m.maximumEmptyViolationC<1e-6&&m.maximumTerminalTemperatureDifferenceC<=.05;
      m.savingPct=m.fairSavingEligible&&base.hvacKwh>0?m.hvacDifferenceFromBaselineKwh/base.hvacKwh*100:null;}
    return {version:2,module:'spatial-control-optimization',date:records[0].date,settings:pl.settings,parameters:pl.parameters,modes,
      scope:'相同热区与设备假设，两台平均输出独立分配；23.6/23.9℃均属23—24℃范围，实时与预测可选相同目标；最后30分钟共用恢复要求，恢复耗电纳入总量。',
      unknowns:'风量、风机功率和实际供冷覆盖未查证；fanKw默认0不构造风机节电，0.1/0.3kW另作敏感性；启动Wh默认0。南北各半供冷的原默认失败保留。',
      method:'两台输出通过线性温度约束和通用部分负荷曲线分配，不是已验证变频指令或厂商控制器；许可保持10/10分钟，切换目标惩罚20Wh不记作电耗。',isMeasured:false};
  }
  function ablation(records,artifact,input={}){const pl=plant({...input,forecastMode:'persistence'});return runPolicy(records,artifact,'predictive',pl);}
  function sensitivity(records,artifact,input={}){
    const cases=[];for(const mixingWPerK of [300,1000,3000,5000])for(const ownSegmentShare of [.5,.7,.85]){
      const result=simulateDay(records,artifact,{...input,mixingWPerK,ownSegmentShare});cases.push({mixingWPerK,ownSegmentShare,modes:result.modes.map(m=>({id:m.id,hvacKwh:m.hvacKwh,temperatureCompliancePct:m.temperatureCompliancePct,maximumOccupiedViolationC:m.maximumOccupiedViolationC,maximumTerminalTemperatureDifferenceC:m.maximumTerminalTemperatureDifferenceC,savingPct:m.savingPct,unitSwitches:m.unitSwitches}))});}
    return {caseCount:cases.length,cases,note:'4种混合强度×3种覆盖方向性，共12个未校准情景。保留原默认300W/K；强混合用于条件诊断，不作为风量测量或拟合结果，不自动选择最有利结果。'};
  }
  return {settings,plant,options,decision,simulateDay,ablation,sensitivity};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=spatialControlOptimized;
