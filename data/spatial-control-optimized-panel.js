'use strict';
(()=>{
  const get=id=>document.getElementById(id),write=(id,t)=>{get(id).textContent=t;},model=spatialControlOptimized,time=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
  const colors=['#7c8d86','#4d8195','#587c45'];let latest=null,ablated=null;
  for(const day of environmentDataset.daily){const o=document.createElement('option');o.value=day.date;o.textContent=day.date;get('controlSpatialDate').append(o);}
  function records(){return environmentDataset.records.filter(r=>r.date===get('controlSpatialDate').value);}
  function input(){return {pattern:get('controlSpatialPattern').value,initialTemperatureC:Number(get('controlSpatialInitial').value),mixingWPerK:Number(get('controlSpatialMixing').value),ownSegmentShare:Number(get('controlSpatialShare').value),minimumOnMinutes:Number(get('controlSpatialMinOn').value),minimumOffMinutes:Number(get('controlSpatialMinOff').value),indoorFanKw:Number(get('optimizedFan').value),startupWh:Number(get('optimizedStartup').value)};}
  function chart(){
    const peaks=latest.modes.map(mode=>mode.trace.filter((_,i)=>i%5===0).map(t=>({minute:t.minute,temp:Math.max(...t.temperaturesC.filter((_,i)=>t.counts[i]>0))})).filter(t=>Number.isFinite(t.temp)));
    const values=peaks.flatMap(xs=>xs.map(t=>t.temp)),low=Math.floor(Math.min(22,...values)),high=Math.ceil(Math.max(25,...values)),x=m=>43+(m-390)/960*370,y=t=>207-(t-low)/(high-low)*170;
    let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 445 245"><rect x="43" y="${y(24)}" width="370" height="${y(23)-y(24)}" fill="#e6efdc"/>`;
    for(let t=low;t<=high;t++)svg+=`<line x1="43" y1="${y(t)}" x2="413" y2="${y(t)}" stroke="#e0e7da"/><text x="5" y="${y(t)+4}" fill="#66785e" font-size="11">${t}℃</text>`;
    peaks.forEach((rows,i)=>{svg+=`<polyline points="${rows.map(t=>x(t.minute).toFixed(2)+','+y(t.temp).toFixed(2)).join(' ')}" fill="none" stroke="${colors[i]}" stroke-width="2"/>`;});
    svg+='<text x="43" y="232" fill="#66785e" font-size="11">06:30</text><text x="370" y="232" fill="#66785e" font-size="11">22:30</text></svg>';get('controlSpatialChart').innerHTML=svg;
  }
  function drawDecision(){
    const mode=latest.modes.find(m=>m.id===get('controlSpatialView').value),minute=Number(get('controlSpatialTime').value),d=mode.decisions.find(d=>d.minute===minute),t=mode.trace.find(t=>t.minute===minute);
    write('controlSpatialDecision',`${time(minute)} · ${mode.name} · 当前许可：${spatialThermalModel.modes[t.requestMask].name}。当前分区${d.currentCounts.join('/')}人${d.predictedCounts?`；下一点假设分区${d.predictedCounts.join('/')}人`:''}。${d.reason}。西/东平均供冷比例${t.meanCoolingFractions.map(f=>(f*100).toFixed(1)).join('/ ')}%仅为模型结果；目标室温${t.targetTemperatureC}℃。`);
    get('controlSpatialMap').innerHTML=latest.parameters.zones.map((z,i)=>{const temp=t.temperaturesC[i],occupied=t.counts[i]>0,cl=occupied?(temp>24+1e-7?'hot':temp<23-1e-7?'cold':''):'empty';return `<article class="zone-cell ${z.id} ${cl}"><h3>${z.name}</h3><div class="zone-number">${temp.toFixed(2)}<small> ℃</small></div><p>${t.counts[i]}人情景 · ${(t.zoneCoolingW[i]/1000).toFixed(2)}kW显冷分配</p></article>`;}).join('');
    get('controlSpatialCandidates').innerHTML=d.candidateSummary.length?d.candidateSummary.slice(0,16).map(c=>`<tr><th>${spatialThermalModel.modes[c.firstMask].name} / ${c.firstTarget}℃</th><td>${spatialThermalModel.modes[c.secondMask].name} / ${c.secondTarget}℃</td><td>${c.energyKwh.toFixed(3)}kWh</td><td>${c.terminalEquivalentKwh.toFixed(3)}kWh等效</td><td>${c.maxViolationC.toFixed(3)}℃</td></tr>`).join(''):'<tr><td colspan="5">日常基准保留两台许可，不使用人数预测选择候选。</td></tr>';
  }
  function draw(){
    const bad=latest.modes.filter(m=>m.maximumOccupiedViolationC>1e-6),verdict=get('controlSpatialVerdict');verdict.className='comparison-verdict'+(bad.length?'':' pass');
    verdict.innerHTML=bad.length?`<strong>当前假设下存在有人区超限，不能作为达标节电结果。</strong><p>${bad.map(m=>m.name).join('、')}有温度违规。固定供冷覆盖与区域混合可能使冷热负荷无法兼顾；这不证明现场设备不足。</p>`:'<strong>本情景的有人区采样室温均满足23—24℃。</strong><p>仍需核对空区与末端储热，再解释电耗差；未做现场温度或电耗验证。</p>';
    get('controlSpatialRows').innerHTML=latest.modes.map(m=>`<tr><th>${m.name}</th><td>${m.hvacKwh.toFixed(2)}kWh</td><td>${m.temperatureCompliancePct===null?'无人情景':m.temperatureCompliancePct.toFixed(2)+'%'}</td><td>${m.maximumOccupiedViolationC.toFixed(3)}℃</td><td>${m.hvacDifferenceFromBaselineKwh.toFixed(2)}kWh</td><td>${m.storedChangeKwhThermal.toFixed(3)}kWh热量</td><td>${m.unitSwitches.join('／')}次</td><td>${m.savingPct===null?'条件未共同满足':m.savingPct.toFixed(2)+'%（情景）'}</td></tr>`).join('');
    write('controlSpatialStorage',`三种照明用电均为${latest.modes[0].lightingKwh.toFixed(3)}kWh。正负储热差折算仅用于检查延后降温：${latest.modes.map(m=>m.name+' '+m.terminalAdjustedDifferenceKwh.toFixed(3)+'kWh等效差').join('；')}。它不是已经发生的耗电或经过验证的节电。`);
    chart();const pred=latest.modes[2],different=pred.trace.filter((t,i)=>t.requestMask!==ablated.trace[i].requestMask||t.targetTemperatureC!==ablated.trace[i].targetTemperatureC).length;
    get('controlSpatialAblation').innerHTML=`<p>冻结预测改变了<strong>${different}</strong>分钟的当前供冷许可或室温目标。</p><div class="pair">冻结预测：${pred.hvacKwh.toFixed(2)}kWh · 有人区区时比例${pred.temperatureCompliancePct.toFixed(2)}%</div><div class="pair">保持人数不变：${ablated.hvacKwh.toFixed(2)}kWh · 有人区区时比例${ablated.temperatureCompliancePct.toFixed(2)}%</div><p>对照减预测的电耗差为${(ablated.hvacKwh-pred.hvacKwh).toFixed(3)}kWh；正值少用电、负值多用电。不保证预测一定更省电或更舒适。</p>`;
    const select=get('controlSpatialTime');select.innerHTML='';for(const d of pred.decisions){const o=document.createElement('option');o.value=d.minute;o.textContent=time(d.minute);select.append(o);}
    const first=pred.decisions.find(d=>{const i=d.minute-latest.settings.startMinute;return pred.trace[i].requestMask!==ablated.trace[i].requestMask||pred.trace[i].targetTemperatureC!==ablated.trace[i].targetTemperatureC;});select.value=first?.minute??latest.settings.startMinute;drawDecision();
  }
  function update(){try{write('controlSpatialFeedback','正在演算三种策略与预测增量对照……');const r=records(),settings=input();latest=model.simulateDay(r,reservationArtifact,settings);ablated=model.ablation(r,reservationArtifact,settings);
    const role=r[0].role==='training'?'训练期回放':'训练期外历史回放，两日已用于开发检查';write('controlSpatialScope',`${latest.date} · ${role}。一楼人数为含暂离登记代理；区域分配是假设，室温为模型状态。06:30初温由人工给定，默认无开馆前控制；起点后每分钟演算。`);get('controlSpatialSensitivityResult').innerHTML='';draw();write('controlSpatialFeedback','演算完成；保留所有温度违规和电耗增加，没有控制现场设备。');
  }catch(error){write('controlSpatialFeedback',error.message);}}
  function reset(){get('controlSpatialDate').value='2026-06-29';get('controlSpatialPattern').value='west';get('controlSpatialInitial').value='24';get('controlSpatialMixing').value='300';get('controlSpatialShare').value='0.7';get('controlSpatialMinOn').value='10';get('controlSpatialMinOff').value='10';get('controlSpatialView').value='predictive';get('optimizedFan').value='0';get('optimizedStartup').value='0';update();}
  get('controlSpatialRun').addEventListener('click',update);get('controlSpatialReset').addEventListener('click',reset);
  for(const id of ['controlSpatialDate','controlSpatialPattern','controlSpatialInitial','controlSpatialMixing','controlSpatialShare','controlSpatialMinOn','controlSpatialMinOff','optimizedFan','optimizedStartup'])get(id).addEventListener('change',update);
  get('controlSpatialView').addEventListener('change',()=>{if(latest)drawDecision();});get('controlSpatialTime').addEventListener('change',()=>{if(latest)drawDecision();});
  get('controlSpatialSensitivity').addEventListener('click',()=>{if(!latest)return;const button=get('controlSpatialSensitivity');button.disabled=true;write('controlSpatialFeedback','正在核对12个覆盖／混合组合，请稍候……');
    setTimeout(()=>{try{const result=model.sensitivity(records(),reservationArtifact,input());get('controlSpatialSensitivityResult').innerHTML=`<p>${result.note}</p><div class="table-wrap"><table><thead><tr><th>换热 W/K</th><th>本段份额</th><th>基准区时比例</th><th>实时区时比例</th><th>预测区时比例</th></tr></thead><tbody>${result.cases.map(c=>`<tr><td>${c.mixingWPerK}</td><td>${(c.ownSegmentShare*100).toFixed(0)}%</td>${c.modes.map(m=>`<td>${m.temperatureCompliancePct.toFixed(1)}%</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;write('controlSpatialFeedback','12组核对完成；没有自动改成有利参数。');}catch(error){write('controlSpatialFeedback',error.message);}finally{button.disabled=false;}},0);
  });reset();
})();
