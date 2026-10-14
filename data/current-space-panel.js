'use strict';
(() => {
  const source=window.CarbonJointSpaceEvidence,meters=window.CarbonJointEvidence,twin=window.CarbonSpaceTwin;
  const get=id=>document.getElementById(id),modeSelect=get('spaceMode'),timeRange=get('spaceTimeRange');
  const emptyLayers=()=>Object.fromEntries(['occupancy','lighting','hvac'].map(key=>[key,{
    values:[0,0,0,0],display:['—','—','—','—'],total:'—',potential:'回放数据不可用'
  }]));
  if(!Array.isArray(source?.cases)||!Array.isArray(meters?.cases)||!twin||!modeSelect||!timeRange){
    const status=get('spaceContext');
    if(status)status.textContent='四区回放数据未加载，无法展示空间快照；请核查页面资源。';
    const timeLabel=get('spaceTimeLabel');
    if(timeLabel)timeLabel.textContent='—';
    if(twin)twin.update(emptyLayers());
    return;
  }
  const names={baseline:'日常基准',realtime:'实时感知',predictive:'预测协同'};
  const comfort=document.createElement('p');
  comfort.id='spaceComfort';comfort.className='space-comfort';
  document.querySelector('.twin-side .space-caveat').before(comfort);
  let state={date:get('jointDate').value,mixingWPerK:Number(get('jointMix').value),index:Number(timeRange.value)};
  const sum=a=>a.reduce((n,v)=>n+v,0),fixed=(n,d=2)=>Number(n).toFixed(d);
  const clock=minute=>`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
  const interval=minute=>`${clock(minute)}—${clock(minute+5)}`;
  function commandLabel(command){return command.split('_').map((value,i)=>`${i+1}号${value==='off'?'关闭':`许可 ${value}℃`}`).join(' / ');}
  function unavailable(message='没有找到所选条件的四区回放；空间快照不可用。'){
    get('spaceContext').textContent=message;
    get('spaceTimeLabel').textContent='—';
    comfort.textContent='四区模型室温筛选不可用。';
    comfort.classList.remove('fail');
    twin.update(emptyLayers());
  }
  function render(){
    const spatial=source.cases.find(c=>c?.date===state.date&&c.mixingWPerK===state.mixingWPerK);
    const meter=meters.cases.find(c=>c?.date===state.date&&c.mixingWPerK===state.mixingWPerK);
    const mode=modeSelect.value,index=state.index;
    if(!spatial?.modes?.[mode]?.[index]||!meter?.modes?.[mode]?.points?.[index]){
      unavailable();return;
    }
    const frame=spatial.modes[mode][index],point=meter.modes[mode].points[index];
    if(!Array.isArray(frame)||frame.length!==3||frame.some(values=>!Array.isArray(values)||values.length!==4)){
      unavailable('四区快照格式异常，已停止展示空间数据。');return;
    }
    const [counts,lights,temperatures]=frame;
    const occupiedTemperatures=temperatures.filter((_,i)=>counts[i]>0);
    const occupiedMaxMatches=occupiedTemperatures.length?
      Number.isFinite(point.occupiedMaxC)&&Math.abs(Math.max(...occupiedTemperatures)-point.occupiedMaxC)<=1e-9:
      point.occupiedMaxC==null;
    if(counts.some(n=>!Number.isInteger(n)||n<0)||lights.some(n=>!Number.isFinite(n)||n<0)||
       temperatures.some(n=>!Number.isFinite(n))||sum(counts)>314||sum(lights)!==point.lightingWatts||
       point.minute!==390+index*5||!occupiedMaxMatches){
      unavailable('四区快照与分项回放不一致，已停止展示空间数据。');return;
    }
    const occupied=counts.map((count,i)=>count>0?i:-1).filter(i=>i>=0);
    const passing=occupied.filter(i=>temperatures[i]>=22.2&&temperatures[i]<=26.8).length;
    comfort.textContent=occupied.length?`区间末有人区模型室温筛选：${passing}/${occupied.length}区在22.2—26.8℃${passing===occupied.length?'。':'；存在越界，不能按温度合格情景展示。'}`:'该区间没有代理占用区，有人区室温筛选不适用。';
    comfort.classList.toggle('fail',passing!==occupied.length);
    const hvacText=`两机名义均功率 ${fixed(point.hvacAverageKw)} kW · ${commandLabel(point.hvacCommand)}`;
    const layers={
      occupancy:{values:counts,display:counts.map(v=>`${v} 人（代理）`),total:`${sum(counts)} 人（代理）`,potential:hvacText},
      lighting:{values:lights,display:lights.map(v=>`${v} W`),total:`${sum(lights)} W · ${point.tubesOn}根`,potential:hvacText},
      hvac:{values:temperatures.map(v=>Math.max(0,Math.min(1,(v-20)/8))),display:temperatures.map(v=>`${fixed(v)}℃`),
        total:`${fixed(Math.min(...temperatures))}—${fixed(Math.max(...temperatures))}℃`,potential:hvacText}
    };
    twin.update(layers);
    const active=document.querySelector('.layer-btn.active')?.dataset.layer||'occupancy';
    get('spaceSummaryLabel').textContent={occupancy:'一楼登记人数代理',lighting:'四区灯具显热',hvac:'四区模型室温范围'}[active];
    get('spaceContext').textContent=`${Number(state.date.slice(5,7))}月${Number(state.date.slice(8))}日 · ${state.mixingWPerK} W/K · ${interval(point.minute)} · ${names[mode]}`;
    get('spaceTimeLabel').textContent=interval(point.minute);
    timeRange.value=String(index);
  }
  document.addEventListener('carbon:joint-view',event=>{state=event.detail;render();});
  document.addEventListener('carbon:joint-unavailable',()=>{
    state={date:get('jointDate').value,mixingWPerK:Number(get('jointMix').value),index:Number(timeRange.value)};
    unavailable();
  });
  modeSelect.addEventListener('change',render);
  timeRange.addEventListener('input',()=>window.CarbonJointPanel.selectIndex(Number(timeRange.value)));
  document.querySelectorAll('.layer-btn').forEach(button=>button.addEventListener('click',()=>{
    const label={occupancy:'一楼登记人数代理',lighting:'四区灯具显热',hvac:'四区模型室温范围'}[button.dataset.layer];
    get('spaceSummaryLabel').textContent=label;
  }));
  render();
})();
