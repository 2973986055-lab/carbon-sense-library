'use strict';

(() => {
  const get=id=>document.getElementById(id),text=(id,value)=>get(id).textContent=value;
  const ids=['controlDate','controlLead','controlInitialTemp','controlThermalMass',
    'controlHvacStop','controlHvacMinOn','controlHvacMinOff','controlHvacSwitchCost','controlHvacForecast',
    'controlDistribution','controlLightingPolicy','controlTubeLumens','controlUtilisation',
    'controlMaintenance','controlLuxTarget','controlVacancyDelay','controlDaylightScale'];
  const fields=Object.fromEntries(ids.map(id=>[id,get(id)]));
  for(const day of environmentDataset.daily) {
    const option=document.createElement('option');option.value=day.date;option.textContent=day.date;
    fields.controlDate.append(option);
  }
  fields.controlDate.value='2026-06-29';
  reservationArtifact.times.forEach((label,slot)=>{
    const option=document.createElement('option');option.value=slot;option.textContent=label;
    get('controlZoneTime').append(option);
  });
  get('controlZoneTime').value=32;
  const colours=['#607364','#2d9b9c','#668f42'];
  const number=(field,min,max,step,fallback)=>{
    const value=interactiveModel.normalizeNumeric(field.value,{min,max,step,fallback}).value;
    field.value=value;return value;
  };
  const time=minute=>minute==null?'—':`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
  let latest=null,latestRecords=null,latestInput=null,advancedCurrent=false,view='day';
  function zonePreview(result) {
    const minute=Number(get('controlZoneTime').value)*30,mode=result.modes.find(m=>m.id===get('controlZoneMode').value),trace=mode.trace[minute];
    text('controlZoneScope',`${time(minute)} · ${trace.people}人登记代理（含暂离） · ${mode.name}开启${trace.tubes}/42根顶灯。1区暂视为靠窗，7区为内侧，分布与位置均未实测。`);
    const forecast=trace.lightingForecast;
    text('controlDaylightOutlook',`当前南窗辐射情景 ${trace.southVerticalIrradianceWm2.toFixed(1)} W/㎡（ERA5历史输入）${forecast?`；下一半小时人数预测${forecast.people}人，关灯保护采用辐射${forecast.southVerticalIrradianceWm2.toFixed(1)} W/㎡。采光下降趋势外推未验证，仅用于暂缓关灯。`:'；照度卡片分别显示当前电照明与自然光的贡献。'}`);
    get('controlZoneMap').innerHTML=trace.lightingZones.map(z=>`<article class="zone-light-card${z.occupied>0&&z.totalLux<result.settings.targetLux?' insufficient':''}"><div><h4>${z.name}</h4><span>${z.occupied} / ${z.capacity}座（假设）</span></div><div class="zone-light-status" aria-label="开启${z.tubesOn}根，共3根">${[0,1,2].map(i=>`<i class="${i<z.tubesOn?'on':'off'}"></i>`).join('')}<b>${z.tubesOn}/3根</b></div><p>平均模型照度 ${z.totalLux.toFixed(0)} lx <small>（电照明${z.electricLux.toFixed(0)}＋自然光${z.daylightLux.toFixed(0)}）</small></p><small>${z.occupied===0?'空置情景':z.totalLux>=result.settings.targetLux?'平均值满足筛选阈值':'平均值不足；不能认定现场不合格'}</small></article>`).join('');
    text('controlZoneNote',`每区面积暂按27㎡平均分配。偏暗区保留全部相关灯，其他区仍可减灯；全开电照明平均值约${(42*result.settings.tubeLumens*result.settings.utilisationFactor*result.settings.maintenanceFactor/378).toFixed(0)}lx，仅为假设计算。没有实测灯位、桌面照度或座位占用，分区平均值不能保证每个桌面达标。`);
  }
  function chart(result) {
    const first=result.modes[0].trace.find(t=>t.people>0)?.minute ?? 390;
    const lo=view==='day'?0:Math.max(0,first-90),hi=view==='day'?1439:Math.min(1439,first+90);
    const series=result.modes.map(m=>m.trace.filter(t=>t.minute>=lo&&t.minute<=hi&&((t.minute-lo)%3===0||t.minute===hi)));
    const temperatures=series.flat().map(t=>t.temperatureC);
    const low=Math.min(22.5,...temperatures)-.15,high=Math.max(24.5,...temperatures)+.15;
    const x=minute=>48+(minute-lo)/(hi-lo)*684,y=value=>22+(high-value)/(high-low)*178;
    let svg=`<rect x="48" y="${y(24)}" width="684" height="${y(23)-y(24)}" fill="#ebf3df"/><text x="53" y="${y(24)+12}" fill="#869a70">目标23—24℃</text>`;
    for(const value of [23,24,Math.ceil(high)-1]) {
      svg+=`<line x1="48" y1="${y(value)}" x2="732" y2="${y(value)}" stroke="#e5ece0"/><text x="15" y="${y(value)+4}">${value}℃</text>`;
    }
    for(let i=0;i<5;i++) {
      const minute=Math.round(lo+(hi-lo)*i/4);
      svg+=`<text x="${x(minute)}" y="222" text-anchor="middle">${time(minute)}</text>`;
    }
    if(first>=lo&&first<=hi)svg+=`<line x1="${x(first)}" y1="22" x2="${x(first)}" y2="200" stroke="#adbda3" stroke-dasharray="3 4"/><text x="${x(first)+5}" y="14">情景开始有人</text>`;
    series.forEach((points,i)=>{svg+=`<polyline fill="none" stroke="${colours[i]}" stroke-width="${i===0?3:2}"${i===1?' stroke-dasharray="6 4"':''} points="${points.map(t=>`${x(t.minute).toFixed(2)},${y(t.temperatureC).toFixed(2)}`).join(' ')}"/>`;});
    get('controlTemperatureChart').innerHTML=svg;
    get('controlTemperatureChart').setAttribute('aria-label',`${view==='day'?'全天':'首次情景有人前后'}三策略模型室温曲线，目标23—24℃，不是实测`);
  }
  function hvacPreview(result) {
    const value=get('controlHvacTime').value||'16:05',parts=value.split(':').map(Number);
    const minute=Math.max(0,Math.min(1439,parts[0]*60+parts[1]));
    const pred=result.modes[2].trace[minute],decision=pred.hvacDecision;
    text('controlHvacScope',`${time(minute)} · 当前${pred.people}人含暂离登记代理 · 有人时模型室温要求23—24℃；当前动作与设备设定值分开。`);
    get('controlHvacActions').innerHTML=result.modes.map(m=>{
      const t=m.trace[minute];return `<tr><th>${m.name}</th><td>${t.temperatureBeforeC.toFixed(2)}℃</td><td>${t.hvacRequestOn?'两台共同供冷请求':'暂停请求'}</td><td>${(t.heatLoadW/1000).toFixed(2)} kW</td></tr>`;
    }).join('');
    text('controlHvacForecastNote',decision?`下一采样点${time(minute+decision.targetOffsetMinutes)}人数预测${decision.forecastPeople}人，按起点室温、天气与灯功率估计总显热${(decision.forecastHeatW/1000).toFixed(2)} kW，包含传热和换气；传热随轨迹室温更新。${decision.reason}。当前人数保持至下一采样点后采用预测值，30分钟窗口每次只执行当前动作。`:'未生成前瞻候选。');
    const candidates=decision?.candidates||decision&&[decision.chosen]||[];
    get('controlHvacCandidates').innerHTML=candidates.map(c=>`<tr><th>${c.requestOn?'供冷':'暂停'}${c.requestOn===pred.hvacRequestOn?'（选中）':''}</th><td>${c.minimumTemperatureC.toFixed(2)}—${c.maximumTemperatureC.toFixed(2)}℃${c.violationDegreeMinutes>1e-7?' · 有越界':''}</td><td>${c.energyKwh.toFixed(3)} kWh</td><td>${c.objectiveKwh.toFixed(3)} kWh等效</td></tr>`).join('');
  }
  function advancedTables() {
    const result=latest,records=latestRecords,input=latestInput;
    const leads=controlScenarioModel.leadComparison(records,reservationArtifact,input);
    get('controlLeadRows').innerHTML=leads.map(r=>`<tr><th scope="row">${r.leadMinutes}分钟</th><td>${r.energyKwh.toFixed(2)}</td><td>${r.temperatureCompliancePct==null?'—':`${r.temperatureCompliancePct.toFixed(1)}%`}</td><td>${r.firstArrivalTemperatureC==null?'—':`${r.firstArrivalTemperatureC.toFixed(1)}℃`}</td></tr>`).join('');
    const sensitivity=controlScenarioModel.sensitivity(records,reservationArtifact,input);
    get('controlSensitivityRows').innerHTML=result.modes.map((m,i)=>{
      const values=sensitivity.rows.map(r=>r.modes[i]);
      const energy=values.map(v=>v.energyKwh),compliance=values.map(v=>v.temperatureCompliancePct).filter(Number.isFinite);
      return `<tr><th scope="row">${m.name}</th><td>${Math.min(...energy).toFixed(2)}—${Math.max(...energy).toFixed(2)}</td><td>${compliance.length?`${Math.min(...compliance).toFixed(1)}—${Math.max(...compliance).toFixed(1)}%`:'—'}</td></tr>`;
    }).join('');
    advancedCurrent=true;
  }
  function update() {
    const input={leadMinutes:Number(fields.controlLead.value),
      initialTemperatureC:number(fields.controlInitialTemp,18,35,.5,28),
      thermalMassMultiplier:number(fields.controlThermalMass,1,30,1,10),
      feedbackStopTemperatureC:number(fields.controlHvacStop,23,23.9,.1,23.5),
      minimumRequestOnMinutes:number(fields.controlHvacMinOn,1,15,1,5),
      minimumRequestOffMinutes:number(fields.controlHvacMinOff,1,15,1,5),
      requestSwitchCostWh:number(fields.controlHvacSwitchCost,0,50,1,0),
      hvacForecast:fields.controlHvacForecast.value,
      distribution:fields.controlDistribution.value,lightingPolicy:fields.controlLightingPolicy.value,
      tubeLumens:number(fields.controlTubeLumens,500,5000,100,2000),
      utilisationFactor:number(fields.controlUtilisation,.1,1,.1,.6),
      maintenanceFactor:number(fields.controlMaintenance,.1,1,.1,.8),
      targetLux:number(fields.controlLuxTarget,300,750,50,300),
      vacancyDelayMinutes:number(fields.controlVacancyDelay,0,60,5,15),
      daylightScale:number(fields.controlDaylightScale,0,2,.25,1)};
    const records=environmentDataset.records.filter(r=>r.date===fields.controlDate.value);
    const result=controlScenarioModel.simulateDay(records,reservationArtifact,input);latest=result;
    latestRecords=records;latestInput=input;advancedCurrent=false;
    const maxEnergy=Math.max(1,...result.modes.map(m=>m.energyKwh));
    get('controlModeCards').innerHTML=result.modes.map((m,i)=>`<article class="control-mode-card mode-${m.id}"><div class="control-mode-title"><span>0${i+1}</span><h3>${m.name}</h3></div><small>单日模型用电</small><strong>${m.energyKwh.toFixed(2)} <em>kWh</em></strong><div class="control-mode-bar"><i style="width:${m.energyKwh/maxEnergy*100}%"></i></div><div class="control-mode-delta${m.savedKwh<-.00001?' more-energy':''}">${m.id==='fixed'?'比较基准':Math.abs(m.savedKwh)<1e-8?'与基准同耗电':`${m.savedKwh<0?'较基准多耗':'较基准少耗'} ${Math.abs(m.savedKwh).toFixed(3)} kWh`}</div><div class="control-energy-parts"><span>顶灯 ${m.lightingKwh.toFixed(2)} kWh</span><span>空调 ${m.hvacKwh.toFixed(2)} kWh</span></div><dl><div><dt>23—24℃模型室温满足比例</dt><dd>${m.temperatureCompliancePct==null?'—':`${m.temperatureCompliancePct.toFixed(1)}%`}</dd></div><div><dt>占用区照度满足比例（模型）</dt><dd>${m.illuminanceCompliancePct==null?'未评价':`${m.illuminanceCompliancePct.toFixed(1)}%`}</dd></div><div><dt>有人时平均模型室温</dt><dd>${m.meanOccupiedTemperatureC==null?'—':`${m.meanOccupiedTemperatureC.toFixed(2)}℃`}</dd></div><div><dt>首次有人时模型室温</dt><dd>${m.firstArrivalTemperatureC==null?'—':`${m.firstArrivalTemperatureC.toFixed(1)}℃`}</dd></div><div><dt>供冷请求切换（模型）</dt><dd>${m.hvacRequestSwitches}次</dd></div><div><dt>使用期逐根灯光开关</dt><dd>${m.lightingWithinSessionSwitchOperations}次</dd></div></dl></article>`).join('');
    const real=result.modes[1],pred=result.modes[2];
    const extra=pred.energyKwh-real.energyKwh;
    const change=(pred.temperatureCompliancePct??0)-(real.temperatureCompliancePct??0);
    let note=Math.abs(extra)<1e-8 ? '本组条件下预测与实时同耗电。'
      : `本组条件下预测相对实时${extra>=0?'多耗':'少耗'}${Math.abs(extra).toFixed(3)} kWh。`;
    if(Math.abs(change)>1e-8)note+=` 温度合格率变化${change>=0?'+':''}${change.toFixed(2)}个百分点。`;
    const hvacExtra=pred.hvacKwh-real.hvacKwh;
    note+=` 其中空调${hvacExtra>=0?'多耗':'少耗'}${Math.abs(hvacExtra).toFixed(3)} kWh；差值包含控制与灯具散热变化。`;
    if(pred.temperatureCompliancePct<100-1e-7||pred.insufficientLightingMinutes>0&&input.lightingPolicy!=='fixed')note+=' 本组室温或照度仍有不足，正差值仅为条件测算，未证明可行节电。';
    text('controlResultNote',note);
    const replay=result.predictionEvaluationStatus.startsWith('训练期回放') ? '训练期回放（仅演示）' : '训练期外情景';
    text('controlContext',`${result.date} · ${replay} · 同一登记代理与ERA5历史天气 · 有人时室温约束23—24℃ · 供冷请求尚未映射硬件 · 顶灯42根18W，分布与照度为假设`);
    if(get('controlMethods').open)advancedTables();
    text('controlAssumptions',result.predictionEvaluationStatus+'；'+result.assumptions.join('；')+'。');
    text('controlCapacityNote',result.modes.some(m=>m.capacityLimitedMinutes>0)?'本组假设中出现供冷容量受限；未达到温度目标的时段仍计入结果。':'本组假设未出现供冷容量受限；温度合格率仅评价模型室温，不代表实测或综合热舒适。');
    chart(result);
    zonePreview(result);
    hvacPreview(result);
  }
  get('controlZoneTime').addEventListener('change',()=>zonePreview(latest));
  get('controlZoneMode').addEventListener('change',()=>zonePreview(latest));
  get('controlHvacTime').addEventListener('change',()=>hvacPreview(latest));
  get('controlMethods').addEventListener('toggle',()=>{if(get('controlMethods').open&&!advancedCurrent)advancedTables();});
  for(const field of Object.values(fields)) {
    field.addEventListener('change',update);
    field.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();update();}});
  }
  for(const button of get('controlChartViews').querySelectorAll('button'))button.addEventListener('click',()=>{
    view=button.dataset.view;
    for(const b of get('controlChartViews').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b===button));
    chart(latest);
  });
  get('controlReset').addEventListener('click',()=>{
    fields.controlDate.value='2026-06-29';fields.controlLead.value=0;fields.controlInitialTemp.value=28;
    fields.controlThermalMass.value=10;fields.controlHvacStop.value=23.5;
    fields.controlHvacMinOn.value=5;fields.controlHvacMinOff.value=5;fields.controlHvacSwitchCost.value=0;fields.controlHvacForecast.value='frozen';
    fields.controlDistribution.value='uniform';fields.controlLightingPolicy.value='daylight';
    fields.controlTubeLumens.value=2000;fields.controlUtilisation.value=.6;fields.controlMaintenance.value=.8;
    fields.controlLuxTarget.value=300;fields.controlVacancyDelay.value=15;fields.controlDaylightScale.value=1;
    get('controlZoneTime').value=32;get('controlZoneMode').value='realtime';get('controlHvacTime').value='16:05';update();
  });
  update();
})();
