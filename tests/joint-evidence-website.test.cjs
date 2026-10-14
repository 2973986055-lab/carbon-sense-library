'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'data/joint-evidence-data.js'),'utf8');
const actionSource=fs.readFileSync(path.join(root,'data/joint-forecast-action-data.js'),'utf8');
const contributionSource=fs.readFileSync(path.join(root,'data/joint-forecast-contribution-data.js'),'utf8');
const context={window:{}};
vm.runInNewContext(source,context);
vm.runInNewContext(actionSource,context);
vm.runInNewContext(contributionSource,context);
const payload=context.window.CarbonJointEvidence;
const actions=context.window.CarbonJointForecastActionEvidence;
const contribution=context.window.CarbonForecastContributionEvidence;
const ablationBytes=fs.readFileSync(path.join(root,'evidence/forecast-fixed-light-ablation.json'));
const ablation=JSON.parse(ablationBytes);
assert.equal(payload.version,'20261014-joint-split-local');
assert.equal(payload.cases.length,6);
assert.equal(actions.cases.length,6);
assert.equal(actions.decisionPointsPerCase,192);
assert.equal(contribution.cases.length,6);
assert.equal(contribution.sourceAblationSha256,require('node:crypto').createHash('sha256').update(ablationBytes).digest('hex'));
assert.ok(!source.includes('totalKwh'));
const seen=new Set();
for(const item of payload.cases){
  const key=`${item.date}/${item.mixingWPerK}`;
  assert.ok(!seen.has(key),`duplicate case: ${key}`);
  seen.add(key);
  const action=actions.cases.find(a=>a.date===item.date&&a.mixingWPerK===item.mixingWPerK);
  assert.ok(action,`${key}: missing forecast action audit`);
  const fixed=contribution.cases.find(a=>a.date===item.date&&a.mixingWPerK===item.mixingWPerK);
  const original=ablation.cases.find(a=>a.date===item.date&&a.mixingWPerK===item.mixingWPerK);
  assert.ok(fixed&&original,`${key}: missing fixed-lighting ablation`);
  assert.ok(Math.abs(fixed.realtimeHvacKwh-original.modes.realtime.hvacKwh)<1e-8);
  assert.ok(Math.abs(fixed.predictiveHvacKwh-original.modes.predictive.hvacKwh)<1e-8);
  assert.ok(Math.abs(fixed.predictiveMinusRealtimeKwh-original.predictiveVsRealtime.hvacDifferenceKwh)<1e-8);
  assert.equal(fixed.temperatureComparable,original.predictiveVsRealtime.temperatureComparable);
  assert.equal(fixed.sameStateCommandChanges,original.modes.predictive.sameStateCommandChanges);
  assert.equal(fixed.qualifiedSavingPct,null);
  const rawBytes=fs.readFileSync(path.join(root,'evidence/joint-replays',action.replaySource));
  assert.equal(require('node:crypto').createHash('sha256').update(rawBytes).digest('hex'),action.replaySha256);
  const raw=JSON.parse(rawBytes);
  const selected=raw.modes.predictive.trace.map(p=>p.guard).filter(g=>g?.reason==='forecast_selected');
  assert.equal(action.forecastSelectedCount,selected.length);
  assert.equal(action.sameStateCommandChanges,selected.filter(g=>g.predictiveCommand!==g.realtimeCommand).length);
  assert.equal(action.crossModeCommandDifferences,raw.modes.realtime.trace.filter((p,i)=>p.command!==raw.modes.predictive.trace[i].command).length);
  for(const mode of ['baseline','realtime','predictive']){
    const entry=item.modes[mode];
    assert.equal(entry.points.length,192,`${key}/${mode} must cover 16 hours at five-minute intervals`);
    assert.equal(entry.points[0].time,'06:30');
    assert.equal(entry.points.at(-1).time,'22:25');
    assert.ok(entry.points.every(point=>point.hvacAverageKw>=0&&point.hvacAverageKw<=20&&point.lightingWatts>=0&&point.lightingWatts<=756));
    const lighting=entry.points.reduce((sum,p)=>sum+p.lightingWatts/12000,0);
    const hvac=entry.points.reduce((sum,p)=>sum+p.hvacAverageKw/12,0);
    assert.ok(Math.abs(lighting-entry.lighting.kwh)<1e-7,`${key}/${mode} lighting series mismatch`);
    assert.ok(Math.abs(hvac-entry.hvac.kwh)<1e-7,`${key}/${mode} HVAC series mismatch`);
  }
}
const keyCase=payload.cases.find(c=>c.date==='2026-06-30'&&c.mixingWPerK===1000);
assert.ok(keyCase.linkage.sameHighLevelCommands);
assert.ok(keyCase.linkage.firstLightingDifference);
assert.ok(keyCase.linkage.firstTemperatureDifference);
assert.ok(keyCase.linkage.firstHvacEnergyDifference);
assert.ok(keyCase.modes.realtime.hvac.kwh!==keyCase.modes.predictive.hvac.kwh);
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert.match(html,/2026年6月29—30日历史回放/);
assert.doesNotMatch(html,/id="clock"|setInterval\(/);
assert.match(html,/id="jointLightingBars"/);
assert.match(html,/id="jointHvacBars"/);
assert.match(html,/id="jointLightingChart"/);
assert.match(html,/id="jointHvacChart"/);
assert.match(html,/id="jointForecastAuditBody"/);
assert.doesNotMatch(html,/6月29—30日已反复用于开发检查，不是现场实测或未触碰的新验证。/);
assert.equal((html.match(/模型情景节电率 · 相对日常基准/g)||[]).length,2);
assert.match(html,/模型情景节电率＝（同组日常基准名义电量－当前策略名义电量）/);
assert.doesNotMatch(html,/温度可比门槛|不可比|日末最大温差不超过0\.05℃/);
assert.match(html,/不要求日末温度相同/);
for(const file of ['evidence/README.md','evidence/forecast-fixed-light-ablation.json','evidence/forecast-terminal-guard-step-sensitivity.json']){
  assert.ok(fs.existsSync(path.join(root,file)),`missing linked evidence: ${file}`);
  assert.ok(html.includes(`href="${file}"`),`missing evidence link: ${file}`);
}
assert.match(html,/data\/joint-evidence-data\.js/);
assert.match(html,/data\/joint-forecast-action-data\.js/);
assert.match(html,/data\/joint-forecast-contribution-data\.js/);
assert.match(html,/data\/joint-evidence-panel\.js/);
assert.ok(html.indexOf('data/joint-forecast-action-data.js')<html.indexOf('data/joint-evidence-panel.js'));
assert.ok(html.indexOf('data/joint-forecast-contribution-data.js')<html.indexOf('data/joint-evidence-panel.js'));
assert.doesNotMatch(html,/照明与V3空调尚未使用同一空间/);
const elements=new Map();
function element(id){
  if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',listeners:{},
    addEventListener(event,handler){this.listeners[event]=handler;},
    querySelector(){return {setAttribute(){}};},setAttribute(){}});
  return elements.get(id);
}
element('jointDate').value='2026-06-30';
element('jointMix').value='1000';
const panelContext={window:{CarbonJointEvidence:payload,CarbonJointForecastActionEvidence:actions,
  CarbonForecastContributionEvidence:contribution},
  document:{getElementById:element,dispatchEvent(){}},CustomEvent:class{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'data/joint-evidence-panel.js'),'utf8'),panelContext);
assert.equal(element('jointCursorTime').textContent,'09:05—09:10');
const baselineHvacWidth=()=>Number(element('jointHvacBars').innerHTML.match(/class="baseline" style="width:([0-9.]+)%/)[1]);
assert.ok(baselineHvacWidth()>0&&baselineHvacWidth()<100,'6/30 baseline bar should use the six-case scale');
assert.match(element('jointHvacChart').innerHTML,/>20\.0<\/text>/);
panelContext.window.CarbonJointPanel.selectIndex(191);
assert.equal(element('jointCursorTime').textContent,'22:25—22:30');
element('jointDate').value='2026-06-29';
element('jointDate').listeners.change();
assert.equal(element('jointCursorTime').textContent,'22:25—22:30','date switch should keep the selected five-minute interval');
element('jointMix').value='5000';
element('jointMix').listeners.change();
assert.equal(element('jointCursorTime').textContent,'22:25—22:30','mixing switch should keep the selected five-minute interval');
element('jointMix').value='300';
element('jointMix').listeners.change();
assert.equal(baselineHvacWidth(),100,'6/29 300 W/K reaches the common HVAC bar scale');
for(const fixed of contribution.cases){
  element('jointDate').value=fixed.date;
  element('jointMix').value=String(fixed.mixingWPerK);
  element('jointDate').listeners.change();
  const displayed=element('jointForecastAuditBody').textContent;
  assert.match(displayed,/固定42灯全开后/);
  const action=actions.cases.find(item=>item.date===fixed.date&&item.mixingWPerK===fixed.mixingWPerK);
  assert.match(displayed,new RegExp(`当前联算${action.sameStateCommandChanges}/192次，固定灯对照${fixed.sameStateCommandChanges}/192次`));
  assert.match(displayed,fixed.predictiveMinusRealtimeKwh>1e-8?/比实时多用/:fixed.predictiveMinusRealtimeKwh<-1e-8?/比实时少用/:/与实时相同/);
  assert.match(displayed,fixed.bothTemperaturePass?/均通过模型温度边界/:/至少一种未通过模型温度边界/);
  assert.ok(displayed.includes(`两者四区日末最大温差${fixed.terminalDifferenceC.toFixed(3)}℃（辅助信息）`));
  assert.doesNotMatch(displayed,/可比|0\.05℃|门槛/);
  assert.match(element('jointForecastAuditHeading').textContent,/节电率比较整套策略/);
  assert.match(displayed,/各策略与日常基准的分项名义电量/);
  assert.match(displayed,/预测独立节电的稳健性与跨日影响仍待验证/);
  const selectedCase=payload.cases.find(item=>item.date===fixed.date&&item.mixingWPerK===fixed.mixingWPerK);
  const temperatureFoot=element('jointHvacFoot').textContent;
  assert.match(temperatureFoot,/四区日末最大温差（相对基准，辅助信息）/);
  assert.doesNotMatch(temperatureFoot,/可比|门槛/);
  for(const [label,key] of [['实时','baselineToRealtime'],['预测','baselineToPredictive']]){
    assert.ok(temperatureFoot.includes(`${label}${selectedCase.comparisons[key].hvac.terminalDifferenceC.toFixed(3)}℃`));
  }
  assert.match(element('jointVerdict').textContent,/不要求日末温度相同/);
  for(const [metric,id] of [['lighting','jointLightingBars'],['hvac','jointHvacBars']]){
    const rows=element(id).innerHTML;
    assert.match(rows,/基准参照/);
    for(const mode of ['realtime','predictive']){
      const expected=(100*(selectedCase.modes.baseline[metric].kwh-selectedCase.modes[mode][metric].kwh)/selectedCase.modes.baseline[metric].kwh).toFixed(2);
      assert.ok(rows.includes(`节电率 ${expected}%`),`${fixed.date}/${fixed.mixingWPerK}/${metric}/${mode}: missing baseline-relative rate`);
    }
  }
}
for(const [baselineKwh,predictiveKwh,expected] of [[100,110,'节电率 -10.00%'],[0,1,'基准为0，未计算']]){
  const synthetic={...keyCase,modes:{...keyCase.modes,
    baseline:{...keyCase.modes.baseline,hvac:{...keyCase.modes.baseline.hvac,kwh:baselineKwh}},
    predictive:{...keyCase.modes.predictive,hvac:{...keyCase.modes.predictive.hvac,kwh:predictiveKwh}}}};
  const isolated=new Map(),get=id=>{
    if(!isolated.has(id))isolated.set(id,{value:'',textContent:'',innerHTML:'',
      addEventListener(){},querySelector(){return {setAttribute(){}};}});
    return isolated.get(id);
  };
  get('jointDate').value=synthetic.date;get('jointMix').value=String(synthetic.mixingWPerK);
  vm.runInNewContext(fs.readFileSync(path.join(root,'data/joint-evidence-panel.js'),'utf8'),{
    window:{CarbonJointEvidence:{...payload,cases:[synthetic]},CarbonJointForecastActionEvidence:actions,CarbonForecastContributionEvidence:contribution},
    document:{getElementById:get,dispatchEvent(){}},CustomEvent:class{}
  });
  assert.ok(get('jointHvacBars').innerHTML.includes(expected));
  assert.doesNotMatch(get('jointHvacBars').innerHTML,/NaN|Infinity/);
  if(baselineKwh>0)assert.match(get('jointHvacBars').innerHTML,/joint-saving-rate is-negative/);
}
for(const auditSources of [
  {CarbonJointForecastActionEvidence:{},CarbonForecastContributionEvidence:contribution},
  {CarbonJointForecastActionEvidence:actions,CarbonForecastContributionEvidence:{}}
]){
  const isolated=new Map();
  const get=id=>{
    if(!isolated.has(id))isolated.set(id,{value:'',textContent:'',innerHTML:'',
      addEventListener(){},querySelector(){return {setAttribute(){}};}});
    return isolated.get(id);
  };
  get('jointDate').value='2026-06-29';get('jointMix').value='1000';
  vm.runInNewContext(fs.readFileSync(path.join(root,'data/joint-evidence-panel.js'),'utf8'),{
    window:{CarbonJointEvidence:payload,...auditSources},
    document:{getElementById:get,dispatchEvent(){}},CustomEvent:class{}
  });
  assert.notEqual(get('jointLightingBars').innerHTML,'');
  assert.match(get('jointForecastAuditHeading').textContent,/暂不可核验/);
  assert.match(get('jointForecastAuditBody').textContent,/证据未加载或不完整/);
  assert.match(get('jointLinkage').textContent,/固定照明对照数据不可用/);
}
element('jointDate').value='2026-07-01';
element('jointDate').listeners.change();
assert.match(element('jointVerdict').textContent,/未找到所选日期/);
assert.equal(element('jointLightingBars').innerHTML,'');
assert.equal(element('jointHvacChart').innerHTML,'');
assert.equal(element('jointCursorTime').textContent,'—');
assert.match(element('jointForecastAuditBody').textContent,/回放数据不可用/);
element('jointDate').value='2026-06-30';
element('jointDate').listeners.change();
assert.notEqual(element('jointLightingBars').innerHTML,'');
assert.match(element('jointForecastAuditBody').textContent,/固定42灯全开后/);
vm.runInNewContext(fs.readFileSync(path.join(root,'data/joint-evidence-panel.js'),'utf8'),{
  window:{},document:{getElementById:element,dispatchEvent(){}},CustomEvent:class{}
});
assert.match(element('jointVerdict').textContent,/三策略回放数据未加载/);
assert.equal(element('jointLightingBars').innerHTML,'');
assert.match(element('jointForecastAuditHeading').textContent,/暂不可核验/);
console.log(JSON.stringify({passed:true,cases:seen.size,pointsPerMode:192,meters:['lighting','HVAC']}));
