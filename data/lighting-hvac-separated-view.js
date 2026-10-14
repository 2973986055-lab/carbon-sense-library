'use strict';

// Read-only presentation adapter for the coupled replay. It deliberately
// exposes two electricity series, never an HVAC+lighting headline or rate.
const lightingHvacSeparatedView=(()=>{
  const sum=a=>a.reduce((x,y)=>x+y,0);
  const near=(a,b)=>Math.abs(a-b)<1e-8;
  function minuteLabel(minute){return `${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;}
  function mode(result){
    if(!result||!['baseline','realtime','predictive'].includes(result.mode)||!Array.isArray(result.trace)||result.trace.length!==192)
      throw new Error('Expected a complete coupled daily replay');
    const points=result.trace.map(t=>({minute:t.minute,time:minuteLabel(t.minute),peopleProxy:t.people,
      tubesOn:t.tubesOn,lightingWatts:sum(t.zoneLightWatts),zoneLightingWatts:[...t.zoneLightWatts],
      lightingKwh5m:t.lightingKwh,hvacKwh5m:t.hvacKwh,hvacAverageKw:t.hvacKwh*12,
      occupiedMaxC:Math.max(...t.endingC.filter((_,i)=>t.counts[i]>0)),
      zoneTemperaturesC:[...t.endingC],hvacCommand:t.command}));
    for(const p of points)if(!near(p.lightingWatts,p.tubesOn*18)||!near(p.lightingKwh5m,p.lightingWatts/12000))throw new Error('Lighting trace does not balance');
    if(!near(sum(points.map(p=>p.lightingKwh5m)),result.lightingKwh)||!near(sum(points.map(p=>p.hvacKwh5m)),result.hvacKwh))
      throw new Error('Displayed series do not reconcile with the daily meters');
    return {mode:result.mode,date:result.date,
      lighting:{kwh:result.lightingKwh,switches:result.switches,modelTargetCompliancePct:result.modelTargetCompliancePct,
        fullOnModelTargetCompliancePct:result.fullOnModelTargetCompliancePct,notWorseThanFullOnModel:result.lightingServicePass},
      hvac:{kwh:result.hvacKwh,occupiedTemperatureCompliancePct:result.occupiedCompliancePct,
        sampledTemperaturePass:result.temperaturePass,finalTemperaturesC:[...result.finalTemperaturesC],
        storedChangeKwhThermal:result.storedChangeKwhThermal},
      points};
  }
  function compare(reference,candidate){
    if(reference.date!==candidate.date||reference.points.length!==candidate.points.length)throw new Error('Mismatched comparison');
    const terminalDifferenceC=Math.max(...reference.hvac.finalTemperaturesC.map((t,i)=>Math.abs(t-candidate.hvac.finalTemperaturesC[i])));
    const temperatureComparable=reference.hvac.sampledTemperaturePass&&candidate.hvac.sampledTemperaturePass&&terminalDifferenceC<=.05;
    return {reference:reference.mode,candidate:candidate.mode,date:reference.date,
      lighting:{candidateMinusReferenceKwh:candidate.lighting.kwh-reference.lighting.kwh,
        candidateVsReferencePct:100*(candidate.lighting.kwh/reference.lighting.kwh-1)},
      hvac:{candidateMinusReferenceKwh:candidate.hvac.kwh-reference.hvac.kwh,
        candidateVsReferencePct:100*(candidate.hvac.kwh/reference.hvac.kwh-1),terminalDifferenceC,
        temperatureComparable},
      qualification:'未核实灯位/桌面照度、四区室温与实际电耗；分项差值均为条件模拟，不作为实测节电率'};
  }
  function linkage(reference,candidate){
    if(reference.date!==candidate.date||reference.points.length!==candidate.points.length)throw new Error('Mismatched linkage');
    const a=reference.points,b=candidate.points;
    const sameHighLevelCommands=a.every((p,i)=>p.hvacCommand===b[i].hvacCommand);
    const lightDifferent=a.flatMap((p,i)=>p.tubesOn!==b[i].tubesOn?[i]:[]);
    const temperatureDifferent=a.flatMap((p,i)=>p.zoneTemperaturesC.some((v,j)=>Math.abs(v-b[i].zoneTemperaturesC[j])>1e-6)?[i]:[]);
    const hvacDifferent=a.flatMap((p,i)=>Math.abs(p.hvacKwh5m-b[i].hvacKwh5m)>1e-8?[i]:[]);
    const first=(indices)=>indices.length?{minute:a[indices[0]].minute,time:a[indices[0]].time}:null;
    return {reference:reference.mode,candidate:candidate.mode,sameHighLevelCommands,
      lightingDifferentSlots:lightDifferent.length,temperatureDifferentSlots:temperatureDifferent.length,hvacEnergyDifferentSlots:hvacDifferent.length,
      firstLightingDifference:first(lightDifferent),firstTemperatureDifference:first(temperatureDifferent),firstHvacEnergyDifference:first(hvacDifferent),
      lightingDifferenceKwh:candidate.lighting.kwh-reference.lighting.kwh,
      hvacDifferenceKwh:candidate.hvac.kwh-reference.hvac.kwh,
      interpretation:sameHighLevelCommands&&lightDifferent.length&&temperatureDifferent.length&&hvacDifferent.length?
        '两种模式在同一输入与同一空调高层指令序列下，灯状态先分歧，随后模拟室温及压缩机耗电分歧；这是联算因果演示，不是现场因果验证。':
        '高层指令不同或本情景没有形成完整分歧；只能展示联算轨迹，不做单独归因。'};
  }
  function caseView(raw){
    const modes=Object.fromEntries(Object.entries(raw.modes).map(([key,value])=>[key,mode(value)]));
    return {id:raw.id,date:raw.date,mixingWPerK:raw.mixingWPerK,
      modes,comparisons:{baselineToRealtime:compare(modes.baseline,modes.realtime),
        baselineToPredictive:compare(modes.baseline,modes.predictive),realtimeToPredictive:compare(modes.realtime,modes.predictive)},
      realtimeToPredictiveLinkage:linkage(modes.realtime,modes.predictive),
      labels:{scope:'一楼314座登记人数代理与假设灯位，6/29—30已反复查看的历史回放',
        mixing:'四区混合W/K为未校准敏感性参数',lighting:'42根18W顶灯；照度仅为假设平均值',
        hvac:'两台空调额定输入×模拟压缩机运行时长，非实测电表',
        noSum:'照明与空调独立显示；灯热仍进入空调温度和用电计算。'}};
  }
  return {mode,compare,linkage,caseView};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=lightingHvacSeparatedView;
