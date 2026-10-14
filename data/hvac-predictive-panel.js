'use strict';
(()=>{
  const get=id=>document.getElementById(id),m=hvacPredictiveModel,clock=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
  let current=null,worker=null,busy=false;const controls=['predictDate','predictPattern','predictCoverage','predictSensor','predictMixing','predictFeedback','predictInitial','predictBeam'];
  function lock(on){busy=on;for(const id of [...controls,'predictRun','predictReset'])get(id).disabled=on;get('predictAblation').disabled=on||!current;}
  function options(){return {pattern:get('predictPattern').value,coverage:get('predictCoverage').value,sensor:get('predictSensor').value,mixingWPerK:Number(get('predictMixing').value),initialTemperatureC:Number(get('predictInitial').value),beamWidth:Number(get('predictBeam').value),...(get('predictFeedback').value==='matched'?{}:{feedbackThermalSettings:{mixingWPerK:1000}})};}
  function snapshot(){if(!current)return;const d=current.decisions[Number(get('predictTime').value)];if(!d)return;const pr=d.projection;
    get('predictInputs').textContent=`${clock(d.minute)}：当前${pr.currentPeople}人，下一半小时预测${pr.predictedPeople}人；${pr.futureUsedInWindow?'预测人数在'+clock(pr.nextBoundaryMinute)+'进入本次推演窗口':'下一采样点在窗口末端或之后，本次不套用该人数'}。天气在窗口内保持当前值。`;
    get('predictMap').innerHTML=spatialOccupancyModel.zones.map((z,i)=>{const t=d.executedFirstBlock.initialTemperaturesC[i],cl=pr.currentCounts[i]>0?(t<23?'cold':t>24?'hot':'pass'):'';return `<div class="zone ${z.id} ${cl}">${z.name}<strong>${t.toFixed(2)}℃</strong><small>当前${pr.currentCounts[i]} → 预测${pr.predictedCounts[i]}人</small></div>`;}).join('');
    const events=d.events.map(e=>`${spatialOccupancyModel.zones[e.zone].name}${e.type==='arrival'?'预计进入有人状态':'预计退空'}，${clock(e.boundaryMinute)}`).join('；');
    get('predictReason').textContent=`${d.reason}。现在执行：${d.command.name}。${events?'占用服务变化：'+events+'。':'窗口内没有预测区域从空到有或从有到空的变化。'} ${pr.forecastStatus==='forecast_fallback'?'预测输入异常，已回退到人数保持。':''}`;
    const hot=d.holdDiagnostic.hotspots.map(h=>`${spatialOccupancyModel.zones[h.zone].name}约${h.offsetMinutes.toFixed(1)}分钟后超过24℃`),cold=d.holdDiagnostic.overcold.map(h=>`${spatialOccupancyModel.zones[h.zone].name}约${h.offsetMinutes.toFixed(1)}分钟后低于23℃`);
    get('predictHotspots').textContent=`当前指令：${d.holdDiagnostic.command.name}。${hot.length||cold.length?[...hot,...cold].join('；')+'。':'按本次窗口输入保持推演，没有发现有人区越界。'} 这是条件推演，当前空调仍有内部温控，并非实测热点。`;
    get('predictPlan').innerHTML=d.best.boundaries.map((b,i)=>`<tr><td>${clock(d.minute+b.offsetMinutes)}${i===0?' · 执行':''}</td><td>${b.command.name}</td>${b.temperaturesC.map(t=>`<td>${t.toFixed(2)}</td>`).join('')}<td>${b.counts.join(' / ')}</td></tr>`).join('');
    const executed=d.executedFirstBlock,expected=d.best.boundaries[0];get('predictExecution').textContent=`前5分钟预计末温：${expected.temperaturesC.map(t=>t.toFixed(2)).join(' / ')}℃；回放模拟末温：${executed.finalTemperaturesC.map(t=>t.toFixed(2)).join(' / ')}℃。执行段名义用电${executed.energyKwh.toFixed(3)}kWh。`;
    get('predictSearch').textContent=`搜索了${d.search.generatedBlocks}个阶段分支，保留${d.search.retainedTerminalSequences}条末端序列，其中${d.search.feasibleTerminalSequences}条通过本次采样边界。选中序列名义电量${d.best.metrics.energyKwh.toFixed(3)}kWh，末端热状态目标项${d.best.terminalEquivalentObjectiveKwh.toFixed(3)}、切换目标项${d.best.switchObjectiveKwh.toFixed(3)}；后二者不是耗电。最大有人区越界${d.best.metrics.maximumOccupiedViolationC.toFixed(3)}℃。`;
    get('predictAblation').disabled=busy;get('predictAblationText').textContent='同样的30分钟规划，仅把未来人数保持为当前值；此检查只针对所选这一步。';
  }
  function chart(){const points=current.trace.filter((_,i)=>i%20===19),low=Math.floor(Math.min(22,...points.flatMap(p=>p.temperaturesC))),high=Math.ceil(Math.max(25,...points.flatMap(p=>p.temperaturesC))),x=t=>48+(t-390)/960*600,y=t=>280-(t-low)/(high-low)*240,colors=['#a87327','#b05742','#3a7994','#766295'];
    let svg=`<svg viewBox="0 0 680 325" role="img" aria-label="四区模拟室温曲线"><rect x="48" y="${y(24)}" width="600" height="${y(23)-y(24)}" fill="#e2eedc"/>`;
    for(let k=0;k<=5;k++){const t=low+(high-low)*k/5;svg+=`<line x1="48" y1="${y(t)}" x2="648" y2="${y(t)}" stroke="#dce4da"/><text x="0" y="${y(t)+4}" fill="#65766d" font-size="13">${t.toFixed(1)}℃</text>`;}
    colors.forEach((color,i)=>{svg+=`<polyline points="${[{minute:390,temperaturesC:current.initialTemperaturesC},...points].map(p=>`${x(p.minute).toFixed(2)},${y(p.temperaturesC[i]).toFixed(2)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>`;});
    get('predictChart').innerHTML=svg+'<text x="48" y="313" fill="#65766d" font-size="14">06:30</text><text x="600" y="313" fill="#65766d" font-size="14">22:30</text></svg>';
  }
  function render(result){current=result;lock(false);
    get('predictVerdict').textContent=`本次回放${result.sampledTemperaturePass?'通过':'未通过'}全程有人区23—24℃及空区20—28℃采样检查。${result.noFeasibleSearchDecisions} / ${result.decisions.length}次决策的有限搜索未找到完整窗口达标序列。${result.outsideDiagnosticRange?'存在温度超出16—40℃诊断范围，应优先检查模型失效。':''} 所有结果仍依赖未校准参数。`;
    get('predictMetrics').innerHTML=`<div class="metric"><small>名义空调用电</small><strong>${result.hvacKwh.toFixed(2)} kWh</strong></div><div class="metric"><small>有人区采样达标比例</small><strong>${result.temperatureCompliancePct?.toFixed(2)??'无人'}%</strong></div><div class="metric"><small>最大有人区越界</small><strong>${result.metrics.maximumOccupiedViolationC.toFixed(3)}℃</strong></div><div class="metric"><small>开关许可调整 西 / 东</small><strong>${result.unitPermissionChanges.join(' / ')}</strong></div>`;
    get('predictEndState').textContent=`四区末温：${result.finalTemperaturesC.map(t=>t.toFixed(2)).join(' / ')}℃；相对初始储热变化${result.storedChangeKwhThermal.toFixed(3)}kWh热量。设备状态保留，没有强制重置或把恢复耗电漏算成节电。`;
    get('predictViolations').textContent=`热越界${result.metrics.hotDegreeMinutes.toFixed(2)}、冷越界${result.metrics.coldDegreeMinutes.toFixed(2)} ℃·区分钟；最大空区越界${result.metrics.maximumEmptyViolationC.toFixed(3)}℃。模拟制冷状态切换西/东${result.compressorTransitions.join(' / ')}次；设温调整${result.unitSetpointChanges.join(' / ')}次。许可调整和本机温控启停分别统计。`;
    const select=get('predictTime');select.innerHTML='';result.decisions.forEach((d,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=clock(d.minute);select.append(o);});select.value='5';chart();snapshot();get('predictStatus').textContent='演算完成。未来预测与执行后模拟温度分列；本模块不计算节电率。';
  }
  function fail(message){lock(false);get('predictStatus').textContent=message;}
  function fallback(date,input){setTimeout(()=>{try{render(m.runDay(environmentDataset.records.filter(r=>r.date===date),reservationArtifact,input));}catch(e){fail(e.message);}},0);}
  function run(){if(busy)return;lock(true);get('predictStatus').textContent='开始推演192次决策；请等待演算完成。';const date=get('predictDate').value,input=options();
    if(typeof Worker==='undefined'){fallback(date,input);return;}
    try{worker=new Worker('data/hvac-predictive-worker.js');worker.onmessage=e=>{if(e.data.type==='progress')get('predictStatus').textContent=`已推演至${clock(e.data.minute)}，继续检查温度及设备保持要求……`;else if(e.data.type==='complete'){worker.terminate();worker=null;render(e.data.result);}else{worker.terminate();worker=null;fail(e.data.message);}};
      worker.onerror=()=>{worker?.terminate();worker=null;fallback(date,input);};worker.postMessage({date,options:input});
    }catch(e){worker=null;fallback(date,input);}
  }
  function reset(){if(busy)return;get('predictDate').value='2026-06-29';get('predictPattern').value='west';get('predictCoverage').value='balanced';get('predictSensor').value='localSouth';get('predictMixing').value='300';get('predictFeedback').value='matched';get('predictInitial').value='24';get('predictBeam').value='8';run();}
  function ablation(){if(!current||busy)return;const d=current.decisions[Number(get('predictTime').value)],record=environmentDataset.records.find(r=>r.date===current.date&&r.slot===Math.floor(d.minute/30));
    try{const input={...current.settings,forecastMode:'persistence'},pl=hvacResponseModel.plant(input),other=m.decision(d.stateAtDecision,record,d.projection.currentCounts,d.minute,reservationArtifact,pl,input);
      get('predictAblationText').textContent=`所选这一步：使用人数预测为“${d.command.name}”；人数保持为“${other.command.name}”。${d.command.id===other.command.id?'首步动作相同，不能据此称人数预测改变了这一步。':'首步动作不同，说明该情景中未来人数信息影响了决策。'} 两者搜索状态为${d.status==='searched_feasible'?'采样可行':'未找到可行'} / ${other.status==='searched_feasible'?'采样可行':'未找到可行'}；不是整日节电对照。`;
    }catch(e){get('predictAblationText').textContent=e.message;}
  }
  for(const id of controls)get(id).addEventListener('change',()=>{get('predictStatus').textContent=`条件已更新，请点击演算；${current?'当前结果仍是'+current.date+'的上次回放。':'尚无回放结果。'}`;});
  get('predictRun').addEventListener('click',run);get('predictReset').addEventListener('click',reset);get('predictTime').addEventListener('change',snapshot);get('predictAblation').addEventListener('click',ablation);reset();
})();
