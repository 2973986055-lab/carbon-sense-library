'use strict';

(() => {
  const get = id => document.getElementById(id);
  const ids = ['climateDate','climateTime','climatePeople','climateHeight','climateAch',
    'climateCurtain','climateOptimizedTemp','climateOptimizedTubes','climateInitialRh','climateShr'];
  const fields = Object.fromEntries(ids.map(id=>[id,get(id)]));
  for (const day of environmentDataset.daily) {
    const option=document.createElement('option');option.value=day.date;
    option.textContent=`${day.date.slice(5)} ${day.weekday}`;fields.climateDate.append(option);
  }
  for (const [slot,time] of reservationArtifact.times.entries()) {
    const option=document.createElement('option');option.value=slot;option.textContent=time;fields.climateTime.append(option);
  }
  fields.climateDate.value='2026-06-29';fields.climateTime.value=32;
  function record() { return environmentDataset.records.find(r=>r.date===fields.climateDate.value&&r.slot===Number(fields.climateTime.value)); }
  function normalizeField(id,min,max,step,fallback) {
    const field=fields[id],raw=field.value;
    const value=interactiveModel.normalizeNumeric(raw,{min,max,step,fallback}).value;
    field.value=value;return value;
  }
  function parameters() {
    return {
      people:normalizeField('climatePeople',0,314,1,record().floorReservationProxy),
      heightM:normalizeField('climateHeight',3.3,5,.1,3.5),
      ach:normalizeField('climateAch',0,3,.1,.5),
      curtainClosedFraction:Number(fields.climateCurtain.value),
      optimizedSetpointC:normalizeField('climateOptimizedTemp',22,28,.5,24),
      optimizedTubes:normalizeField('climateOptimizedTubes',0,42,1,42),
      initialRhPct:normalizeField('climateInitialRh',20,90,1,55),
      shr:normalizeField('climateShr',.5,.95,.05,.75),hours:.5
    };
  }
  const text=(id,value)=>get(id).textContent=value;
  const names={people:'人体显热',lights:'普通照明',solar:'南窗太阳得热',glassConduction:'玻璃传热',southWallConduction:'南外墙传热',airExchange:'空气交换显热'};
  function update() {
    const selected=record(),input=parameters(),comparison=thermalModel.compare(selected,input),base=comparison.baseline;
    const uncertainty=thermalModel.sensitivity(selected,{...input,setpointC:24,tubes:42});
    text('climateHeightFact',`${input.heightM.toFixed(1)}m（暂估）`);
    text('climateWeather',`${selected.date} ${selected.time} · 室外 ${selected.outdoorTemperatureC.toFixed(1)}℃ / RH ${selected.outdoorRelativeHumidityPct}% · 全馆预约原值 ${selected.libraryReservations} · 南窗入射辐射估算 ${selected.southVerticalIrradianceWm2.toFixed(0)} W/㎡`);
    text('climateBaseline',`${base.energyKwh.toFixed(3)} kWh`);
    text('climatePower',`空调平均输入估算 ${base.hvacInputKw.toFixed(2)} kW；照明 ${base.lightingInputKw.toFixed(3)} kW`);
    text('climateLoad',`${(base.coolingLoadRatio*100).toFixed(1)}% / ${(base.electricalEquivalentLoadRatio*100).toFixed(1)}%`);
    text('climateLoadDetail',`制冷 ${base.deliveredCoolingKw.toFixed(2)} kW；所需 ${base.requiredCoolingKw.toFixed(2)} kW`);
    text('climateHumidity',base.humidityEstimatePct==null?'不显示数值':`${base.humidityEstimatePct.toFixed(1)}%`);
    text('climateHumidityDetail',`初始${input.initialRhPct}%假设；人体散湿 ${base.peopleMoistureKgPerHour.toFixed(2)} kg/h`);
    text('climateSensitivity',`${uncertainty.energyKwhRange[0].toFixed(3)}—${uncertainty.energyKwhRange[1].toFixed(3)} kWh`);
    text('climateSensitivityDetail',uncertainty.humidityRangePct?`湿度有效情景 ${uncertainty.humidityRangePct[0].toFixed(1)}—${uncertainty.humidityRangePct[1].toFixed(1)}%；${uncertainty.invalidHumidityScenarios}/16个情景不适用`:'16个组合情景均无法给出恒温湿度估算');
    const shadeLabel=input.curtainClosedFraction===0?'窗帘拉开':input.curtainClosedFraction===1?'窗帘关闭（效果为假设）':'部分遮挡（效果为假设）';
    const warning=[`本面板是假定能维持24℃的准稳态负荷与短时湿度情景，不含启动降温电耗。${shadeLabel}；人数${input.people}为比例参考或人工输入，不是实测。`,...base.flags];
    if(selected.libraryReservations>1232) warning.push('该时刻全馆预约超过1232座台账，可能未去重但尚未确认，原值保留。');
    if(input.optimizedTubes<42) warning.push('减少灯管未验证对应区域照度，不能据此实际关灯。');
    if(input.optimizedSetpointC!==24) warning.push('优化温度是你选择的策略情景，尚未验证舒适度。');
    if(comparison.modes[1].sensibleUnmetKw>0.001) warning.push('优化模式目标温度在该情景下无法维持；用电差不能解释为可行策略收益。');
    text('climateWarning',warning.join(' '));
    get('climateModeRows').innerHTML=comparison.modes.map(mode=>`<tr><th scope="row">${mode.name}</th><td>${mode.setpointC.toFixed(1)}℃ / ${mode.tubes}根</td><td>${mode.energyKwh.toFixed(3)}</td><td>${mode.savedKwh.toFixed(3)}</td><td>${mode.savingPct==null?'—':`${mode.savingPct.toFixed(2)}%`}</td></tr>`).join('');
    text('climatePolicyNote',comparison.policyNote);
    const maxHeat=Math.max(1,...Object.values(base.heatGainsW).map(Math.abs));
    get('climateHeatGains').innerHTML=Object.entries(base.heatGainsW).map(([id,value])=>`<div class="climate-heat-row${value<0?' neg':''}"><span>${names[id]}</span><div class="climate-heat-bar"><i style="width:${Math.abs(value)/maxHeat*100}%"></i></div><span>${(value/1000).toFixed(2)} kW</span></div>`).join('');
    if(selected.slot<47) {
      const forecast=reservationModel.transfer(reservationArtifact,selected.slot,input.people);
      const future=thermalModel.calculate(selected,{...input,people:forecast.people,setpointC:24,tubes:42});
      get('climateForecast').innerHTML=`<strong>${reservationArtifact.times[forecast.targetSlot]}：${forecast.people}人情景</strong><br>30分钟趋势迁移；假定室外天气保持不变，下一时点制冷需求约${future.requiredCoolingKw.toFixed(2)} kW。未使用未来时刻真实人数或天气。${forecast.historicalZero?' 历史清零边界不能用作实际停机依据。':''}${forecast.clipped?' 容量截断并不代表真实人数。':''}`;
    } else text('climateForecast','23:30之后没有对应的历史半小时目标，本面板不外推下一天。');
    const validation=environmentDataset.peopleValidationSummary;
    text('climateValidation',`全馆人数基线：6/24—27拟合；6/29—30共${validation.activeTargets}个开放时段目标，30分钟滚动MAE ${validation.mae.toFixed(2)}人。不是一楼实测误差。天气在负荷层使用，不把7天样本当作已证明的天气/星期效应。`);
  }
  function loadReference() {fields.climatePeople.value=record().floorReservationProxy;update();}
  fields.climateDate.addEventListener('change',loadReference);fields.climateTime.addEventListener('change',loadReference);
  for(const id of ids.filter(id=>id!=='climateDate'&&id!=='climateTime')) {
    fields[id].addEventListener('change',update);
    fields[id].addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();update();}});
  }
  get('climateLoadReference').addEventListener('click',loadReference);
  get('climateReset').addEventListener('click',()=>{
    fields.climateDate.value='2026-06-29';fields.climateTime.value=32;
    for(const [id,value] of Object.entries({climateHeight:3.5,climateAch:.5,climateCurtain:0,
      climateOptimizedTemp:24,climateOptimizedTubes:42,climateInitialRh:55,climateShr:.75})) fields[id].value=value;
    loadReference();
  });
  loadReference();
})();
