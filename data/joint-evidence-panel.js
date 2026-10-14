'use strict';
(() => {
  const evidence=window.CarbonJointEvidence;
  const forecastActions=window.CarbonJointForecastActionEvidence;
  const contribution=window.CarbonForecastContributionEvidence;
  const get=id=>document.getElementById(id),date=get('jointDate'),mix=get('jointMix');
  const names={baseline:'日常基准',realtime:'实时感知',predictive:'预测协同'};
  const colours={baseline:'#aebbb0',realtime:'#7eb693',predictive:'#27836d'};
  const modes=['baseline','realtime','predictive'],format=(n,d=2)=>Number(n).toFixed(d);
  const clock=minute=>`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
  const interval=minute=>`${clock(minute)}—${clock(minute+5)}`;
  let current=null,cursorIndex=31;
  function unavailable(message){
    current=null;
    for(const id of ['jointLightingBars','jointHvacBars','jointLightingChart','jointHvacChart']){
      const el=get(id);if(el)el.innerHTML='';
    }
    for(const id of ['jointLightingFoot','jointHvacFoot','jointLinkage','jointMixNote']){
      const el=get(id);if(el)el.textContent='';
    }
    for(const id of ['jointCursorTime','jointCursorLamps','jointCursorLighting','jointCursorHvac']){
      const el=get(id);if(el)el.textContent='—';
    }
    const verdict=get('jointVerdict'),heading=get('jointForecastAuditHeading'),body=get('jointForecastAuditBody');
    if(verdict)verdict.textContent=message;
    if(heading)heading.textContent='预测贡献暂不可核验';
    if(body)body.textContent='回放数据不可用，无法核验预测动作和用电差。';
    document.dispatchEvent(new CustomEvent('carbon:joint-unavailable'));
  }
  if(!evidence||!Array.isArray(evidence.cases)||!date||!mix){
    unavailable('三策略回放数据未加载，无法显示或比较用电；请核查页面资源。');
    return;
  }
  const barScales=Object.fromEntries(['lighting','hvac'].map(metric=>[
    metric,Math.max(...evidence.cases.flatMap(item=>modes.map(key=>item?.modes?.[key]?.[metric]?.kwh??NaN)))
  ]));
  if(Object.values(barScales).some(value=>!Number.isFinite(value)||value<=0)){
    unavailable('分项用电标尺不可用，无法比较三种策略。');
    return;
  }
  function modeBars(id,metric){
    const values=modes.map(key=>current.modes[key][metric].kwh),max=barScales[metric];
    const baseline=values[0];
    get(id).innerHTML=modes.map((key,i)=>{
      const rate=Number.isFinite(baseline)&&baseline>0&&Number.isFinite(values[i])&&values[i]>=0?100*(baseline-values[i])/baseline:null;
      const label=key==='baseline'?'基准参照':rate===null?'基准为0，未计算':`节电率 ${format(rate)}%`;
      return `<div class="joint-mode-row"><span>${names[key]}</span><div class="joint-mode-track"><i class="${key}" style="width:${100*values[i]/max}%"></i></div><div class="joint-mode-values"><strong>${format(values[i])}</strong><small class="joint-saving-rate${rate!==null&&rate<0?' is-negative':''}">${label}</small></div></div>`;
    }).join('');
  }
  function lineChart(id,field,max,unit){
    const svg=get(id),W=900,H=145,L=42,R=11,T=7,B=12,x=i=>L+(W-L-R)*i/191,y=value=>T+(H-T-B)*(1-value/max);
    const grid=[0,.25,.5,.75,1].map(f=>`<line class="joint-gridline" x1="${L}" y1="${y(max*f)}" x2="${W-R}" y2="${y(max*f)}"/><text class="joint-axislabel" x="2" y="${y(max*f)+4}">${format(max*f,unit==='W'?0:1)}</text>`).join('');
    const paths=modes.map(key=>{
      const points=current.modes[key].points;
      const d=points.map((p,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(p[field]).toFixed(1)}`).join(' ');
      return `<path d="${d}" class="joint-line ${key}"/>`;
    }).join('');
    svg.innerHTML=`${grid}${paths}<line class="joint-cursor" x1="${x(cursorIndex)}" y1="${T}" x2="${x(cursorIndex)}" y2="${H-B}"/>`;
    svg.onpointermove=event=>{
      const box=svg.getBoundingClientRect(),px=(event.clientX-box.left)/box.width*W;
      cursorIndex=Math.max(0,Math.min(191,Math.round((px-L)/(W-L-R)*191)));drawCursor();
    };
  }
  function drawCursor(){
    const x=42+(900-42-11)*cursorIndex/191;
    for(const id of ['jointLightingChart','jointHvacChart']){
      const marker=get(id).querySelector('.joint-cursor');marker.setAttribute('x1',x);marker.setAttribute('x2',x);
    }
    const points=modes.map(key=>current.modes[key].points[cursorIndex]);
    get('jointCursorTime').textContent=interval(points[0].minute);
    get('jointCursorLamps').textContent=points.map(p=>p.tubesOn).join(' / ')+' 根';
    get('jointCursorLighting').textContent=points.map(p=>format(p.lightingWatts,0)).join(' / ')+' W';
    get('jointCursorHvac').textContent=points.map(p=>format(p.hvacAverageKw)).join(' / ')+' kW';
    document.dispatchEvent(new CustomEvent('carbon:joint-view',{detail:{date:date.value,mixingWPerK:Number(mix.value),index:cursorIndex}}));
  }
  function render(){
    current=evidence.cases.find(c=>c.date===date.value&&c.mixingWPerK===Number(mix.value));
    if(!current){unavailable('未找到所选日期与混合假设的三策略回放，无法比较用电。');return;}
    modeBars('jointLightingBars','lighting');modeBars('jointHvacBars','hvac');
    const base=current.modes.baseline,real=current.modes.realtime,pred=current.modes.predictive,l=current.linkage;
    const lightRates=modes.map(key=>`${names[key]}${format(current.modes[key].lighting.modelTargetCompliancePct,1)}%`).join(' / ');
    const localLightPass=real.lighting.notWorseThanFullOnModel&&pred.lighting.notWorseThanFullOnModel;
    get('jointLightingFoot').textContent=`300 lx模型筛选达标率（代理人·分钟）：${lightRates}。${localLightPass?'减灯守住了相对全开模型的局部门槛':'至少一种减灯策略未守住相对全开的局部门槛'}；全开本身也未全面达标，且无桌面照度实测。`;
    const terminalDifference=(label,pair)=>`${label}${format(pair.hvac.terminalDifferenceC,3)}℃`;
    get('jointHvacFoot').textContent=`有人区模型采样达标：基准${format(base.hvac.occupiedTemperatureCompliancePct,1)}% / 实时${format(real.hvac.occupiedTemperatureCompliancePct,1)}% / 预测${format(pred.hvac.occupiedTemperatureCompliancePct,1)}%。四区日末最大温差（相对基准，辅助信息）：${terminalDifference('实时',current.comparisons.baselineToRealtime)} / ${terminalDifference('预测',current.comparisons.baselineToPredictive)}。`;
    const action=forecastActions?.cases?.find(c=>c.date===date.value&&c.mixingWPerK===Number(mix.value));
    const fixed=contribution?.cases?.find(c=>c.date===date.value&&c.mixingWPerK===Number(mix.value));
    const auditReady=action&&fixed&&Number.isInteger(forecastActions.decisionPointsPerCase)&&forecastActions.decisionPointsPerCase>0;
    if(auditReady){
      get('jointForecastAuditHeading').textContent='节电率比较整套策略';
      const difference=fixed.predictiveMinusRealtimeKwh;
      const energy=difference>1e-8?`比实时多用${format(difference,3)} kWh`:difference<-1e-8?`比实时少用${format(-difference,3)} kWh`:'与实时相同';
      const temperatureCheck=fixed.bothTemperaturePass?'实时与预测均通过模型温度边界':'实时与预测至少一种未通过模型温度边界';
      get('jointForecastAuditBody').textContent=`上方模型情景节电率比较各策略与日常基准的分项名义电量，包含灯控、灯热和空调反馈的共同作用，不能全部归因于人数预测。同一状态下，人数预测改变空调候选指令：当前联算${action.sameStateCommandChanges}/${forecastActions.decisionPointsPerCase}次，固定灯对照${fixed.sameStateCommandChanges}/${forecastActions.decisionPointsPerCase}次。固定42灯全开后，预测模式名义空调用电${energy}；${temperatureCheck}；两者四区日末最大温差${format(fixed.terminalDifferenceC,3)}℃（辅助信息）。日末温差不单独否定当天名义电量差，预测独立节电的稳健性与跨日影响仍待验证。`;
    }else{
      get('jointForecastAuditHeading').textContent='预测贡献暂不可核验';
      get('jointForecastAuditBody').textContent='预测动作或固定照明证据未加载或不完整，无法核验预测的独立贡献。';
    }
    get('jointLinkage').textContent=l.sameHighLevelCommands?
      `两模式整日空调高层指令相同；${l.firstLightingDifference?.time??'—'}起灯数不同，${l.firstHvacEnergyDifference?.time??'—'}起名义空调用电不同。预测相对实时：照明${l.lightingDifferenceKwh>=0?'+':''}${format(l.lightingDifferenceKwh,3)} kWh，空调${l.hvacDifferenceKwh>=0?'+':''}${format(l.hvacDifferenceKwh,3)} kWh。此处电量差受灯热与室温反馈影响。`:
      `两模式的灯状态、室温反馈与空调指令轨迹可以同时变化，整日分项电量差不能单独归因于人数预测；${auditReady?'上方固定照明对照用于隔离灯控差异。':'固定照明对照数据不可用，暂不能核验预测作用。'}`;
    const temperatureStatus=modes.map(key=>`${names[key]}${current.modes[key].hvac.sampledTemperaturePass?'通过':'越界'}`).join(' / ');
    get('jointVerdict').textContent=`模型温度边界（有人区22.2—26.8℃、空区20—28℃）：${temperatureStatus}。当天模型情景节电率不要求日末温度相同，日末温差仅作辅助信息；跨日节能需连续回放闭馆夜间和次日。全开灯的300 lx模型筛选未全面达标，结果尚未经现场验证。`;
    const peak=Math.max(...modes.flatMap(key=>current.modes[key].points.map(p=>p.hvacAverageKw)));
    if(!Number.isFinite(peak)||peak>20+1e-9){unavailable('空调功率超出0—20 kW固定图轴，已停止展示本组曲线。');return;}
    lineChart('jointLightingChart','lightingWatts',756,'W');
    lineChart('jointHvacChart','hvacAverageKw',20,'kW');drawCursor();
    const note=get('jointMixNote');if(note)note.textContent=Number(mix.value)===300?'300 W/K为原默认混合情景，温度多次越界。':Number(mix.value)===5000?'5000 W/K为强混合假设，尚无风量或多点室温支持。':'1000 W/K为中间敏感性情景，仍未经现场校准。';
  }
  window.CarbonJointPanel={selectIndex(index){if(!Number.isInteger(index)||index<0||index>191)throw Error('Invalid joint replay point');if(!current)return;cursorIndex=index;drawCursor();}};
  date.addEventListener('change',render);mix.addEventListener('change',render);render();
})();
