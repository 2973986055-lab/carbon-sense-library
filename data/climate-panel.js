'use strict';

(() => {
  const get = id => document.getElementById(id);
  const ids = ['climateDate','climateTime','climatePeople','climateHeight','climateAch',
    'climateCurtain','climateBaselineTemp','climateOperation','climateOptimizedTemp',
    'climateOptimizedTubes','climateInitialRh','climateShr'];
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
    const acRunning = fields.climateOperation.value !== 'closed';
    fields.climateOptimizedTemp.disabled = !acRunning;
    fields.climateOptimizedTubes.disabled = !acRunning;
    return {
      people:normalizeField('climatePeople',0,314,1,record().floorReservationProxy),
      heightM:normalizeField('climateHeight',3.3,5,.1,3.5),
      ach:normalizeField('climateAch',0,3,.1,.5),
      curtainClosedFraction:Number(fields.climateCurtain.value),
      baselineSetpointC:normalizeField('climateBaselineTemp',23,24,.5,24),
      baselineTubes:acRunning ? buildingInputs.operation.baselineLightsOn : 0,
      acRunning,
      optimizedSetpointC:normalizeField('climateOptimizedTemp',22,28,.5,24),
      optimizedTubes:acRunning ? normalizeField('climateOptimizedTubes',0,42,1,42) : 0,
      initialRhPct:normalizeField('climateInitialRh',20,90,1,55),
      shr:normalizeField('climateShr',.5,.95,.05,.75),hours:.5
    };
  }
  const text=(id,value)=>get(id).textContent=value;
  const names={people:'人体显热',lights:'普通照明',solar:'南窗太阳得热',glassConduction:'玻璃传热',southWallConduction:'南外墙传热',airExchange:'空气交换显热'};
  function update() {
    text('climateForecastApplication','');
    const selected=record(),input=parameters(),comparison=thermalModel.compare(selected,input),base=comparison.baseline;
    const uncertainty=thermalModel.sensitivity(selected,{...input,setpointC:base.setpointC,tubes:base.tubes});
    const difference=thermalModel.compareSensitivity(selected,input);
    text('climateHeightFact',`${input.heightM.toFixed(1)}m（暂估）`);
    text('climateWeather',`${selected.date} ${selected.time} · 历史天气 ${selected.outdoorTemperatureC.toFixed(1)}℃ / RH ${selected.outdoorRelativeHumidityPct}%`);
    text('climateBaseline',`${base.energyKwh.toFixed(3)} kWh`);
    text('climatePower',`空调平均输入估算 ${base.hvacInputKw.toFixed(2)} kW；照明 ${base.lightingInputKw.toFixed(3)} kW`);
    text('climateLoad',`${(base.coolingLoadRatio*100).toFixed(1)}% / ${(base.electricalEquivalentLoadRatio*100).toFixed(1)}%`);
    text('climateLoadDetail',`制冷 ${base.deliveredCoolingKw.toFixed(2)} kW；所需 ${base.requiredCoolingKw.toFixed(2)} kW`);
    text('climateHumidity',base.humidityEstimatePct==null?'不显示数值':`${base.humidityEstimatePct.toFixed(1)}%`);
    text('climateHumidityDetail',`初始${input.initialRhPct}%假设；人体散湿 ${base.peopleMoistureKgPerHour.toFixed(2)} kg/h`);
    text('climateSensitivity',`${uncertainty.energyKwhRange[0].toFixed(3)}—${uncertainty.energyKwhRange[1].toFixed(3)} kWh`);
    text('climateSensitivityDetail',uncertainty.humidityRangePct?`湿度有效情景 ${uncertainty.humidityRangePct[0].toFixed(1)}—${uncertainty.humidityRangePct[1].toFixed(1)}%；${uncertainty.invalidHumidityScenarios}/16个情景不适用`:'16个组合情景均无法给出恒温湿度估算');
    text('climateSavingSensitivity',`${difference.savedKwhRange[0].toFixed(3)}—${difference.savedKwhRange[1].toFixed(3)} kWh`);
    text('climateSavingSensitivityDetail',`${difference.capacityInsufficientScenarios}/16个情景无法满足目标供冷；正用电差仍须验证照度和舒适度`);
    const shadeLabel=input.curtainClosedFraction===0?'窗帘拉开':input.curtainClosedFraction===1?'窗帘关闭（效果为假设）':'部分遮挡（效果为假设）';
    const warning=[`本面板是假定能维持所选目标温度的准稳态负荷与短时湿度情景，不含启动降温电耗。${shadeLabel}；人数${input.people}为训练期登记时长校准代理或人工输入，登记口径包含暂离，不是实测在座。基准${base.setpointC}℃是日常23—24℃范围内的情景选择，设备状态独立输入。`,...base.flags];
    if(selected.libraryReservations>1232) warning.push('该时刻全馆预约超过1232座台账，可能未去重但尚未确认，原值保留。');
    if(input.acRunning && input.optimizedTubes<42) warning.push('减少灯管未验证对应区域照度，不能据此实际关灯。');
    if(input.acRunning && input.optimizedSetpointC!==base.setpointC) warning.push('温度设定不同，用电差包含设定温度变化的影响，不能归因于预测算法；舒适度尚未验证。');
    if(input.acRunning && (input.optimizedSetpointC<23 || input.optimizedSetpointC>24)) warning.push('策略目标超出用户报告的常用23—24℃范围，实际可接受范围须另行确认。');
    if(!input.acRunning) warning.push('晚间全关需现场确认无人；切换历史日期或人数不会自动更改设备状态。');
    if(!input.acRunning && input.people>0) warning.push('当前人数情景仍有人，全关状态与使用需求不一致，不能称为满足需求的节能方案。');
    if(input.acRunning && (base.sensibleUnmetKw>0.001 || comparison.modes[1].sensibleUnmetKw>0.001)) warning.push('基准或策略目标温度在该情景下无法维持；用电差不能解释为可行策略收益。');
    text('climateWarning',warning.join(' '));
    const strategy = comparison.modes[1];
    text('climateStrategyEnergy',`${strategy.energyKwh.toFixed(3)} kWh`);
    text('climateBasePolicy',`${base.acRunning ? `${base.setpointC}℃ · 2台空调` : '空调关闭'} · ${base.tubes}根灯`);
    text('climateStrategyPolicy',`${strategy.acRunning ? `${strategy.setpointC}℃ · 2台空调` : '空调关闭'} · ${strategy.tubes}根灯`);
    text('climateStrategySaved',`${strategy.savedKwh.toFixed(3)} kWh`);
    text('climateStrategySavingPct',strategy.savingPct == null ? '基准为零，不计算比例' : `${strategy.savingPct.toFixed(2)}%`);
    get('climateStrategySaved').parentElement.classList.toggle('negative',strategy.savedKwh < -1e-8);
    const scale=Math.max(base.energyKwh,strategy.energyKwh);
    get('climateBaselineBar').style.width=scale > 0 ? `${base.energyKwh/scale*100}%` : '0%';
    get('climateStrategyBar').style.width=scale > 0 ? `${strategy.energyKwh/scale*100}%` : '0%';
    let decision='结果为未校准情景估算；同策略时用电差为零。';
    let important=false;
    if(!input.acRunning && input.people>0) {decision='人数情景仍有人，全关状态与使用需求不一致。';important=true;}
    else if(!input.acRunning) {decision='晚间全关为人工选择情景，需现场确认无人；不显示恒温湿度。';important=true;}
    else if(base.sensibleUnmetKw>.001 || strategy.sensibleUnmetKw>.001) {decision='当前假设下供冷不足，用电差不代表可行节能。';important=true;}
    else if(input.people===0) {decision='人数代理为零不代表现场无人，设备状态仍需人工选择。';important=true;}
    else if(input.optimizedTubes<42) {decision='减少灯管需确认人员所在区域及照度，正用电差不等于已验证收益。';important=true;}
    else if(input.optimizedSetpointC!==base.setpointC) {decision='用电差包含温度设定变化的影响，不能归因于预测算法；舒适度待验证。';important=true;}
    text('climateDecisionNote',decision);
    get('climateDecisionNote').classList.toggle('important',important);
    text('climateWeatherProvenance',`全馆预约原值${selected.libraryReservations}；南窗入射辐射估算${selected.southVerticalIrradianceWm2.toFixed(0)} W/㎡。${selected.libraryReservations>1232 ? '该预约值超过1232座台账，异常原因未确认，原值保留。' : ''}`);
    get('climateModeRows').innerHTML=comparison.modes.map(mode=>`<tr><th scope="row">${mode.name}</th><td>${mode.acRunning ? `${mode.setpointC.toFixed(1)}℃` : '空调关'} / ${mode.tubes}根</td><td>${mode.energyKwh.toFixed(3)}</td><td>${mode.savedKwh.toFixed(3)}</td><td>${mode.savingPct==null?'—':`${mode.savingPct.toFixed(2)}%`}</td></tr>`).join('');
    text('climatePolicyNote',comparison.policyNote);
    const maxHeat=Math.max(1,...Object.values(base.heatGainsW).map(Math.abs));
    get('climateHeatGains').innerHTML=Object.entries(base.heatGainsW).map(([id,value])=>`<div class="climate-heat-row${value<0?' neg':''}"><span>${names[id]}</span><div class="climate-heat-bar"><i style="width:${Math.abs(value)/maxHeat*100}%"></i></div><span>${(value/1000).toFixed(2)} kW</span></div>`).join('');
    if(selected.slot<47) {
      const forecast=reservationModel.transfer(reservationArtifact,selected.slot,input.people);
      const future=thermalModel.calculate(selected,{...input,people:forecast.people,setpointC:base.setpointC,tubes:base.tubes});
      get('climateForecast').innerHTML=`<strong>${reservationArtifact.times[forecast.targetSlot]}：${forecast.people}人情景</strong><br>30分钟趋势迁移；保持当前设备状态和室外天气，按基准${base.setpointC}℃测算，下一时点制冷需求约${future.requiredCoolingKw.toFixed(2)} kW。未使用未来时刻真实人数或天气。${forecast.historicalZero?' 历史清零边界不能用作实际停机依据。':''}${forecast.clipped?' 容量截断并不代表真实人数。':''}`;
    } else text('climateForecast','23:30之后没有对应的历史半小时目标，本面板不外推下一天。');
    const validation=environmentDataset.peopleValidationSummary;
    text('climateValidation',`全馆预约模型：6/24—28训练；6/29—30共${validation.activeTargets}个非零时段目标，30分钟滚动MAE ${validation.mae.toFixed(2)}人。一楼代理另按训练期登记时长校准，后两天事后对照不是实际在座验证。历史ERA5只在负荷层使用。`);
  }
  function loadReference() {fields.climatePeople.value=record().floorReservationProxy;update();}
  window.addEventListener('carbon:forecast',event=>{
    const detail=event.detail;
    if(!detail || !Number.isFinite(detail.people) || !Number.isInteger(detail.originSlot) || detail.originSlot<0 || detail.originSlot>46 || detail.targetSlot!==detail.originSlot+1) return;
    fields.climateTime.value=detail.originSlot;
    fields.climatePeople.value=Math.round(Math.max(0,Math.min(314,detail.people)));
    update();
    text('climateForecastApplication',`已代入${reservationArtifact.times[detail.targetSlot]}的${fields.climatePeople.value}人迁移情景；天气沿用${fields.climateDate.value.slice(5)} ${reservationArtifact.times[detail.originSlot]}，假定未来半小时不变。`);
    text('climateForecast','本次使用上方迁移预测作为需求情景，未继续递推人数；天气保持为预测起点条件。');
  });
  fields.climateDate.addEventListener('change',loadReference);fields.climateTime.addEventListener('change',loadReference);
  for(const id of ids.filter(id=>id!=='climateDate'&&id!=='climateTime')) {
    fields[id].addEventListener('change',update);
    fields[id].addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();update();}});
  }
  get('climateLoadReference').addEventListener('click',loadReference);
  get('climateReset').addEventListener('click',()=>{
    fields.climateDate.value='2026-06-29';fields.climateTime.value=32;
    for(const [id,value] of Object.entries({climateHeight:3.5,climateAch:.5,climateCurtain:0,
      climateBaselineTemp:24,climateOperation:'running',
      climateOptimizedTemp:24,climateOptimizedTubes:42,climateInitialRh:55,climateShr:.75})) fields[id].value=value;
    loadReference();
  });
  loadReference();
})();
