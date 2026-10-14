'use strict';
(()=>{
  const get=id=>document.getElementById(id),m=hvacResponseModel;let current=null;
  const clock=minute=>`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(Math.floor(minute%60)).padStart(2,'0')}`;
  for(const a of m.actions){const option=document.createElement('option');option.value=a.id;option.textContent=a.name;get('responseAction').append(option);}
  function input(){return {coverage:get('responseCoverage').value,sensor:get('responseSensor').value,mixingWPerK:Number(get('responseMixing').value),responseSeconds:Number(get('responseRamp').value)};}
  function snapshot(){if(!current)return;const selected=current.results.find(r=>r.command.id===get('responseAction').value),t=selected.trace[Number(get('responseTime').value)];if(!t)return;
    get('responseDecision').textContent=`${clock(390+t.minute)} · 西/东温控参考 ${t.sensedC.map(x=>x.toFixed(2)).join('/')}℃；制冷状态 ${t.on.map(x=>x?'开':'停').join('/')}；显冷 ${t.coolingKw.map(x=>x.toFixed(1)).join('/')}kW。`;
    get('responseMap').innerHTML=spatialOccupancyModel.zones.map((z,i)=>{const temp=t.temperaturesC[i],occupied=t.counts[i]>0,cl=occupied?(temp<23?'cold':temp>24?'hot':'pass'):'';return `<div class="zone ${z.id} ${cl}"><span>${z.name}</span><br><strong>${temp.toFixed(2)}℃</strong><br><small>${t.counts[i]}人情景 · ${(t.zoneCoolingW[i]/1000).toFixed(2)}kW显冷</small></div>`;}).join('');
  }
  function chart(){if(!current)return;const selected=current.results.find(r=>r.command.id===get('responseAction').value),trace=selected.trace,points=trace.filter((_,i)=>i%20===19),values=trace.flatMap(t=>t.temperaturesC),low=Math.floor(Math.min(22,...values)),high=Math.ceil(Math.max(25,...values)),x=m=>48+m/960*610,y=t=>290-(t-low)/(high-low)*255;
    const colors=['#a87327','#b05742','#3a7994','#766295'];let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 690 340" role="img" aria-label="四区室温轨迹"><rect x="48" y="${y(24)}" width="610" height="${y(23)-y(24)}" fill="#e2eedc"/>`;
    for(let k=0;k<=5;k++){const t=low+(high-low)*k/5;svg+=`<line x1="48" y1="${y(t)}" x2="658" y2="${y(t)}" stroke="#dce5dc"/><text x="2" y="${y(t)+4}" fill="#607769" font-size="13">${t.toFixed(1)}℃</text>`;}
    colors.forEach((c,i)=>{const data=[{minute:0,temperaturesC:selected.initialTemperaturesC},...points];svg+=`<polyline points="${data.map(t=>`${x(t.minute).toFixed(2)},${y(t.temperaturesC[i]).toFixed(2)}`).join(' ')}" fill="none" stroke="${c}" stroke-width="2"/>`;});
    svg+='<text x="48" y="325" fill="#607769" font-size="14">06:30</text><text x="610" y="325" fill="#607769" font-size="14">22:30</text></svg>';get('responseChart').innerHTML=svg;
    const select=get('responseTime'),saved=select.value;select.innerHTML='';trace.forEach((t,i)=>{if(i%20===19){const o=document.createElement('option');o.value=String(i);o.textContent=clock(390+t.minute);select.append(o);}});select.value=saved||'1319';if(!select.value)select.value='19';snapshot();
  }
  function run(){
    get('responseRun').disabled=true;get('responseStatus').textContent='演算固定指令及设备温控响应……';
    setTimeout(()=>{try{const records=environmentDataset.records.filter(r=>r.date===get('responseDate').value),segments=m.daySegments(records,get('responsePattern').value),settings=input(),initial=Array(4).fill(Number(get('responseInitial').value));
      current={results:m.actions.map(a=>m.simulate(segments,settings,a,initial)),settings};
      const passes=current.results.filter(r=>r.fixedCommandPass).length;
      get('responseVerdict').textContent=`9种固定指令中有${passes}种通过当前有人区与空区采样温度检查。${passes===0?'没有通过不代表所有动态控制均不可行；需要继续检查覆盖、设备响应与控制方式。':'通过仍依赖所选假设，不是现场验证。'} 本页不计算节电率。`;
      get('responseRows').innerHTML=current.results.map(r=>`<tr><th>${r.command.name}</th><td>${r.hvacKwh.toFixed(2)}kWh</td><td>${r.sampledCompliancePct===null?'无人':r.sampledCompliancePct.toFixed(2)+'%'}</td><td>${r.maximumOccupiedViolationC.toFixed(2)}℃</td><td>${r.hotDegreeMinutes.toFixed(0)} / ${r.coldDegreeMinutes.toFixed(0)}</td><td>${r.simulatedCompressorTransitions.join(' / ')}</td><td>${r.fixedCommandPass?'采样通过':'未通过'}${r.outsideDiagnosticRange?' · 超出16—40℃诊断范围':''}</td></tr>`).join('');
      const p=m.plant(settings);get('responseCoverageRows').innerHTML=p.parameters.coolingShares.map((ws,i)=>`<tr><th>${i===0?'西机':'东机'}</th>${ws.map(w=>`<td>${(w*100).toFixed(1)}%</td>`).join('')}</tr>`).join('');
      get('responseSensorText').textContent=`测温位置情景：${m.sensorProfiles[settings.sensor]}；四区权重西/东分别为 ${p.sensorWeights.map(ws=>ws.join('/')).join('；')}。`;
      chart();get('responseStatus').textContent='演算完成；所有数值为未校准情景。设温、实际室温和额定电功率分别核算。';
    }catch(error){get('responseStatus').textContent=error.message;}finally{get('responseRun').disabled=false;}},0);
  }
  function reset(){get('responseDate').value='2026-06-29';get('responsePattern').value='west';get('responseCoverage').value='balanced';get('responseSensor').value='localSouth';get('responseMixing').value='300';get('responseInitial').value='24';get('responseRamp').value='0';get('responseAction').value='24_24';run();}
  get('responseRun').addEventListener('click',run);get('responseReset').addEventListener('click',reset);
  for(const id of ['responseDate','responsePattern','responseCoverage','responseSensor','responseMixing','responseInitial','responseRamp'])get(id).addEventListener('change',run);
  get('responseAction').addEventListener('change',chart);get('responseTime').addEventListener('change',snapshot);reset();
})();
