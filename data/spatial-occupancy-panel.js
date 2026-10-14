'use strict';

(() => {
  const get=id=>document.getElementById(id),write=(id,value)=>{get(id).textContent=value;};
  const model=spatialOccupancyModel;
  let manual=false,latest=null;
  const stateNames={scenario_entry:'规则分配后新增',scenario_exit:'规则分配后空置',scenario_occupied:'持续占用情景',scenario_empty:'持续空置情景'};
  for(const day of environmentDataset.daily){const option=document.createElement('option');option.value=day.date;option.textContent=day.date;get('spatialDate').append(option);}
  reservationArtifact.times.forEach((label,slot)=>{const option=document.createElement('option');option.value=slot;option.textContent=label;get('spatialTime').append(option);});
  function record(){return environmentDataset.records.find(r=>r.date===get('spatialDate').value&&r.slot===Number(get('spatialTime').value));}
  function drawMap(id,frame) {
    get(id).innerHTML=frame?frame.zones.map(z=>`<article class="zone-cell ${z.id}${z.people===0?' empty':''}"><h3>${z.name}</h3><div class="zone-number">${z.people}<small> / ${z.capacity}座</small></div><p>${z.seatIdRange[0]}—${z.seatIdRange[1]}号 · ${z.people>0?'占用情景':'空置情景'}</p><div class="zone-meter" aria-hidden="true"><i style="width:${(z.people/z.capacity*100).toFixed(2)}%"></i></div></article>`).join(''):'<div class="no-forecast">本日没有下一采样点，<br>不跨日拼接预测。</div>';
  }
  function update() {
    const r=record();
    latest=model.buildDemand(r,reservationArtifact,{currentPattern:get('spatialPattern').value,futurePattern:get('spatialFuturePattern').value,
      ...(manual?{currentPeople:Number(get('spatialPeople').value)}:{})});
    if(!manual)get('spatialPeople').value=latest.current.totalPeople;
    write('spatialCurrentTime',latest.time);write('spatialCurrentTotal',latest.current.totalPeople);
    write('spatialCurrentLabel',`${latest.current.patternLabel} · ${manual?'人工人数情景':'历史登记代理，含暂离'}`);
    write('spatialCurrentOccupied',`${latest.current.occupiedZoneCount}/4个计算区在本情景中有占用；不是现场区域人数记录。`);
    drawMap('spatialCurrentMap',latest.current);drawMap('spatialFutureMap',latest.future);
    write('spatialFutureTime',latest.future?.time??'暂无下一点');write('spatialFutureTotal',latest.future?.totalPeople??'—');
    write('spatialFutureUnit',latest.future?'人 / 314座':'本日边界');
    write('spatialFutureLabel',latest.future?`${latest.future.patternLabel} · 冻结总人数预测＋假设分配`:'23:30之后没有本日下一采样点');
    write('spatialFutureOccupied',latest.future?`${latest.future.occupiedZoneCount}/4个计算区在未来分配情景中有占用；不是已验证区域预测。`:latest.forecastUnavailableReason);
    const training=reservationArtifact.trainingLabels.includes(latest.date.slice(5));
    write('spatialDataScope',`${latest.date} · ${training?'训练期回放，非独立检验':'训练期外历史回放，日期已用于开发检查'}。切换日期或时刻会载入登记代理；人工输入只改变情景。${latest.allocationRuleChanged?'当前与未来规则不同：区域变化由手动情景指定。':'当前与未来沿用同一分布规则；人数变化导致的区域变化来自该规则。'}`);
    get('spatialChangeRows').innerHTML=latest.changes?latest.changes.map(z=>`<tr><th scope="row">${z.name}</th><td>${z.currentPeople}</td><td>${z.futurePeople}</td><td>${z.difference>0?'+':''}${z.difference}</td><td>${stateNames[z.state]}</td></tr>`).join(''):'<tr><td colspan="5">没有下一采样点，区域变化不计算。</td></tr>';
    write('spatialConservation',`当前分区合计${latest.current.counts.reduce((a,b)=>a+b,0)}人＝当前总数${latest.current.totalPeople}人${latest.future?`；未来合计${latest.future.counts.reduce((a,b)=>a+b,0)}人＝预测总数${latest.future.totalPeople}人`:''}。各区容量70/90/70/84座；南侧160座、北侧154座，总容量314座。`);
    const f=latest.forecastTotal;
    write('spatialForecastMethod',f?`总数来自原冻结模型：下一时刻训练期均值${f.profileNext.toFixed(2)}＋${reservationArtifact.floorWeight}×（当前${f.current}－当前同刻训练均值${f.profileCurrent.toFixed(2)}），限制0—314后取整，得到${f.people}人${f.clipped?'（触及容量上限）':''}。训练日期6/24—28，时间留出6/29—30。未使用下一时刻真实人数或区域记录。`:'分布图仍可查看当前情景，未来总人数及区域状态不伪造。');
  }
  function loadHistory(){manual=false;get('spatialPeople').value=record().floorReservationProxy;update();}
  function reset(){get('spatialDate').value='2026-06-29';get('spatialTime').value='15';get('spatialPattern').value='uniform';get('spatialFuturePattern').value='same';write('spatialInputFeedback','已载入07:30历史登记代理；这是半小时回放，不是实时感知。');loadHistory();}
  get('spatialDate').addEventListener('change',()=>{write('spatialInputFeedback','已切换日期并载入该时刻登记代理。');loadHistory();});
  get('spatialTime').addEventListener('change',()=>{write('spatialInputFeedback','已切换预测起点并载入登记代理。');loadHistory();});
  get('spatialPattern').addEventListener('change',update);get('spatialFuturePattern').addEventListener('change',update);
  get('spatialPeople').addEventListener('change',()=>{
    const raw=get('spatialPeople').value,n=Number(raw);
    if(raw.trim()===''||!Number.isInteger(n)||n<0||n>314){get('spatialPeople').value=latest.current.totalPeople;write('spatialInputFeedback','请输入0—314之间的整数，已保留上次数值。');return;}
    manual=true;write('spatialInputFeedback','已采用人工人数情景，未读取现场人数。');update();
  });
  for(const button of document.querySelectorAll('[data-spatial-people]'))button.addEventListener('click',()=>{manual=true;get('spatialPeople').value=button.dataset.spatialPeople;write('spatialInputFeedback','已载入人工人数例子；未来总数仍由冻结模型计算。');update();});
  get('spatialLoadHistory').addEventListener('click',()=>{write('spatialInputFeedback','已恢复该时刻历史登记代理，未使用下一时刻真值。');loadHistory();});
  get('spatialReset').addEventListener('click',reset);
  reset();
})();
