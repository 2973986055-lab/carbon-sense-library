'use strict';
(() => {
  const get=id=>document.getElementById(id),write=(id,value)=>{get(id).textContent=value;},model=spatialThermalModel;
  let latest=null;
  const colors=['#4c7857','#b18336','#528ca0','#8b7098'];
  for(const day of environmentDataset.daily){const o=document.createElement('option');o.value=day.date;o.textContent=day.date;get('thermalDate').append(o);}
  reservationArtifact.times.forEach((time,i)=>{const o=document.createElement('option');o.value=i;o.textContent=time;get('thermalTime').append(o);});
  function record(){return environmentDataset.records.find(r=>r.date===get('thermalDate').value&&r.slot===Number(get('thermalTime').value));}
  function read(id,min,max){const raw=get(id).value,value=Number(raw);if(raw.trim()===''||!Number.isFinite(value)||value<min||value>max)throw new Error('请检查人数、初温及假设参数的范围，保留上次结果。');return value;}
  function input(){const people=read('thermalPeople',0,314);if(!Number.isInteger(people))throw new Error('情景人数须为0—314整数，保留上次结果。');return {currentPeople:people,currentPattern:get('thermalPattern').value,minutes:read('thermalDuration',30,60),
    initialTemperaturesC:[0,1,2,3].map(i=>read('thermalT'+i,10,45)),ownSegmentShare:read('thermalShare',.5,.95),mixingWPerK:read('thermalMixing',0,5000),massMultiplier:read('thermalMass',1,30),southAreaFraction:read('thermalSouthArea',.2,.8),westAreaFraction:read('thermalWestArea',.2,.8),averageCoolingFraction:read('thermalFraction',0,1)};}
  function chart(result){
    const values=result.samples.flatMap(s=>s.temperaturesC),low=Math.floor(Math.min(22,...values)),high=Math.ceil(Math.max(25,...values)),x=t=>42+t/result.minutes*370,y=t=>207-(t-low)/(high-low)*170;
    let s=`<svg viewBox="0 0 445 245" xmlns="http://www.w3.org/2000/svg"><rect x="42" y="${y(24)}" width="370" height="${y(23)-y(24)}" fill="#e7efdf"/>`;
    for(let t=low;t<=high;t++)s+=`<line x1="42" y1="${y(t)}" x2="412" y2="${y(t)}" stroke="#e3e8de"/><text x="5" y="${y(t)+4}" fill="#67785f" font-size="11">${t}℃</text>`;
    for(let i=0;i<4;i++)s+=`<polyline points="${result.samples.map(a=>x(a.minute).toFixed(2)+','+y(a.temperaturesC[i]).toFixed(2)).join(' ')}" fill="none" stroke="${colors[i]}" stroke-width="2"/>`;
    s+=`<text x="42" y="232" fill="#67785f" font-size="11">起点</text><text x="370" y="232" fill="#67785f" font-size="11">${result.minutes}分钟</text><text x="42" y="19" fill="#67785f" font-size="11">浅绿带：有人区23—24℃比较范围</text></svg>`;
    get('thermalChart').innerHTML=s;
  }
  function draw(){
    const selected=get('thermalView').value,r=latest.modes.find(m=>m.modeId===selected),p=latest.parameters,last=latest.segments.at(-1),ac=model.cooling(selected,r.averageCoolingFraction,p);
    get('thermalModeRows').innerHTML=latest.modes.map(m=>`<tr${m.modeId===selected?' class="selected"':''}><th scope="row">${m.name}</th><td>${m.hvacKwh.toFixed(3)} kWh</td><td>${m.peakOccupiedC===null?'无人情景':`${m.minOccupiedC.toFixed(2)}—${m.peakOccupiedC.toFixed(2)}℃`}</td><td>${m.withinRangePct===null?'不适用':m.withinRangePct.toFixed(1)+'%'}</td><td>${m.hotDegreeMinutes.toFixed(1)} / ${m.coldDegreeMinutes.toFixed(1)} ℃·区分钟</td></tr>`).join('');
    write('thermalMapLabel',`${r.name} · ${r.minutes}分钟后 · 非实测室温${r.outsideAssumedOperatingRange?' · 出现16—40℃之外的状态，不作为设备性能结论':''}`);
    get('thermalMap').innerHTML=p.zones.map((z,i)=>{const t=r.finalTemperaturesC[i],people=last.counts[i],status=people?(t>24?'hot':t<23?'cold':''):'empty';return `<article class="zone-cell ${z.id} ${status}"><h3>${z.name}</h3><div class="zone-number">${t.toFixed(2)}<small> ℃</small></div><p>${people}人情景 · ${people?'有人区23—24℃':'空区温度不强制归零'}</p><p>分配显冷 ${(ac.zoneCoolingW[i]/1000).toFixed(2)} kW</p></article>`;}).join('');
    write('thermalCoolingNote',`两台平均供冷比例均为${(r.averageCoolingFraction*100).toFixed(0)}%情景；关闭的机器不供冷。开启一台时四区仍分到制冷，未假定空区与有人区隔离。`);
    chart(r);write('thermalChartNote',`当前分区${latest.demand.current.counts.join('/')}人${r.minutes===60?`；30分钟后改用预测分区${latest.demand.future.counts.join('/')}人`:''}。初始温度由人工给定，曲线不钳制到目标温度。`);
    const items=[['人体显热',r.ledger.peopleJ],['固定顶灯热量',r.ledger.lightsJ],['南窗太阳得热',r.ledger.solarJ],['围护与外气净热量',r.ledger.outdoorJ],['移走显热（正值）',r.ledger.coolingJ],['室内储热变化',r.ledger.storedJ]];
    get('thermalLedger').innerHTML=items.map(([name,j])=>`<div><small>${name}</small><strong>${(j/3600000).toFixed(3)}</strong><small>kWh 热量，区别于耗电</small></div>`).join('');
    write('thermalResidual',`房间热量残差 ${r.ledger.residualJ.toExponential(2)} J；区域间净交换 ${r.ledger.mixingJ.toExponential(2)} J；最大单步/单区残差 ${r.maxStepResidualJ.toExponential(2)} J。`);
    get('thermalParameterRows').innerHTML=p.zones.map((z,i)=>`<tr><th scope="row">${z.name}</th><td>${z.assumedAreaM2.toFixed(2)}㎡（假设）</td><td>${z.windowAreaM2.toFixed(2)}㎡</td><td>${(p.coolingShares[0][i]*100).toFixed(1)}%</td><td>${(p.coolingShares[1][i]*100).toFixed(1)}%</td></tr>`).join('');
  }
  function update(){
    try{if(record().slot===47&&get('thermalDuration').value==='60'){get('thermalDuration').value='30';write('thermalFeedback','23:30无下一采样点，已改为当前输入30分钟恒定延展情景，不跨日拼接人数预测。');}else write('thermalFeedback','已演算共同输入下的四种固定供冷状态；没有自动控制现场设备。');
      const next=model.preview(record(),reservationArtifact,input());latest=next;
      write('thermalScope',`${latest.demand.date} ${latest.demand.time} · ${record().role==='training'?'训练期历史回放':'训练期外历史回放，已用于开发检查'}。室外${record().outdoorTemperatureC}℃，南窗辐射${record().southVerticalIrradianceWm2}W/㎡，来自网格再分析，并非校园实测。${latest.inputScope}`);
      get('thermalSensitivityResult').innerHTML='';draw();
    }catch(error){write('thermalFeedback',error.message);}
  }
  function reset(){get('thermalDate').value='2026-06-29';get('thermalTime').value='15';get('thermalPeople').value=80;get('thermalPattern').value='west';get('thermalDuration').value='30';for(let i=0;i<4;i++)get('thermalT'+i).value=24;get('thermalShare').value='0.7';get('thermalMixing').value='300';get('thermalMass').value='10';get('thermalSouthArea').value='0.5';get('thermalWestArea').value='0.5';get('thermalFraction').value='0.3';get('thermalView').value='west';update();}
  get('thermalRun').addEventListener('click',update);
  get('thermalReset').addEventListener('click',reset);
  get('thermalLoadHistory').addEventListener('click',()=>{get('thermalPeople').value=record().floorReservationProxy;update();});
  for(const id of ['thermalDate','thermalTime'])get(id).addEventListener('change',()=>{get('thermalPeople').value=record().floorReservationProxy;update();});
  for(const id of ['thermalPeople','thermalPattern','thermalDuration','thermalT0','thermalT1','thermalT2','thermalT3','thermalShare','thermalMixing','thermalMass','thermalSouthArea','thermalWestArea','thermalFraction'])get(id).addEventListener('change',update);
  get('thermalView').addEventListener('change',()=>{if(latest)draw();});
  get('thermalSensitivity').addEventListener('click',()=>{try{if(!latest)return;const result=model.sensitivity(latest.segments,{...input(),initialTemperaturesC:latest.modes[0].initialTemperaturesC});
    get('thermalSensitivityResult').innerHTML=`<p>${result.note}</p><div class="table-wrap"><table><thead><tr><th>固定供冷状态</th><th>有人区最高温范围</th><th>有人区最低温范围</th></tr></thead><tbody>${model.modes.map(m=>{const rs=result.results.map(c=>c.modes.find(r=>r.id===m.id)),range=key=>{const vs=rs.map(r=>r[key]).filter(Number.isFinite);return vs.length?Math.min(...vs).toFixed(2)+'—'+Math.max(...vs).toFixed(2)+'℃':'无人情景';};return `<tr><th>${m.name}</th><td>${range('peakOccupiedC')}</td><td>${range('minOccupiedC')}</td></tr>`;}).join('')}</tbody></table></div><p>参数改变会改变室温轨迹；同一固定供冷比例的耗电不随混合系数自动变化。这不是节电率区间。</p>`;
  }catch(error){write('thermalFeedback',error.message);}});
  reset();
})();
