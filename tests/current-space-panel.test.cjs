'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const context={window:{}};
for(const name of ['joint-evidence-data.js','joint-space-evidence-data.js']){
  vm.runInNewContext(fs.readFileSync(path.join(root,'data',name),'utf8'),context);
}
const meters=context.window.CarbonJointEvidence,space=context.window.CarbonJointSpaceEvidence;
assert.equal(space.version,'20261014-space-sync-local');
assert.equal(space.cases.length,6);
assert.deepEqual(Array.from(space.zoneOrder),['south-west','south-east','north-west','north-east']);
for(const item of space.cases){
  const meter=meters.cases.find(c=>c.date===item.date&&c.mixingWPerK===item.mixingWPerK);
  assert.ok(meter,`${item.date}/${item.mixingWPerK} missing main panel data`);
  for(const mode of ['baseline','realtime','predictive']){
    const frames=item.modes[mode],points=meter.modes[mode].points;
    assert.equal(frames.length,192);
    for(let i=0;i<192;i++){
      const [counts,lights,temps]=frames[i],point=points[i];
      assert.equal(counts.length,4);
      assert.equal(lights.length,4);
      assert.equal(temps.length,4);
      assert.ok(counts.every(n=>Number.isInteger(n)&&n>=0));
      assert.ok(counts.reduce((a,b)=>a+b,0)<=314);
      assert.equal(lights.reduce((a,b)=>a+b,0),point.lightingWatts);
      assert.equal(point.lightingWatts,point.tubesOn*18);
      assert.ok(temps.every(Number.isFinite));
      assert.equal(point.minute,390+i*5);
      assert.equal(Math.max(...temps.filter((_,zone)=>counts[zone]>0)),point.occupiedMaxC);
    }
  }
}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert.match(html,/data\/joint-space-evidence-data\.js/);
assert.match(html,/data\/current-space-panel\.js/);
assert.match(html,/data\/current-space-panel\.css/);
assert.match(html,/id="spaceMode"/);
assert.match(html,/id="spaceTimeRange"/);
assert.match(html,/<meta name="carbon-release" content="20261014-[a-z0-9-]+">/);
assert.match(html,/layerScales=\{occupancy:90,lighting:216,hvac:1\}/);
assert.match(html,/色块深浅采用固定标尺/);
assert.match(html,/回放时段 <strong id="spaceTimeLabel">09:05—09:10/);
assert.doesNotMatch(html,/class="legacy-control-disclosure"|class="legacy-archive"|id="impactCarbon"/);
const archive=fs.readFileSync(path.join(root,'legacy-models-20261014.html'),'utf8');
assert.match(archive,/class="legacy-control-disclosure"/);
assert.match(archive,/class="legacy-archive"/);
assert.match(archive,/id="studySavingPct"/);
const panel=fs.readFileSync(path.join(root,'data/current-space-panel.js'),'utf8');
const values=new Map(),listeners={};
const get=id=>{
  if(!values.has(id))values.set(id,{value:'',textContent:'',events:{},addEventListener(name,fn){this.events[name]=fn;}});
  return values.get(id);
};
vm.runInNewContext(panel,{window:{},document:{getElementById:get}});
assert.match(get('spaceContext').textContent,/四区回放数据未加载/);
assert.equal(get('spaceTimeLabel').textContent,'—');
get('spaceMode').value='predictive';get('spaceTimeRange').value='31';
get('jointDate').value='2026-06-30';get('jointMix').value='1000';
let layers;
vm.runInNewContext(panel,{
  window:{CarbonJointSpaceEvidence:space,CarbonJointEvidence:meters,CarbonSpaceTwin:{update(next){layers=next;}}},
  document:{getElementById:get,createElement(){return {classList:{toggle(){},remove(){}}};},
    querySelector(selector){return selector==='.layer-btn.active'?{dataset:{layer:'occupancy'}}:{before(){}};},
    querySelectorAll(){return [];},addEventListener(name,fn){listeners[name]=fn;}}
});
assert.match(get('spaceContext').textContent,/6月30日/);
assert.notEqual(layers.occupancy.display[0],'—');
const selected=space.cases.find(c=>c.date==='2026-06-30'&&c.mixingWPerK===1000);
const temperatures=selected.modes.predictive[31][2];
temperatures.forEach((value,i)=>assert.ok(Math.abs(layers.hvac.values[i]-Math.max(0,Math.min(1,(value-20)/8)))<1e-12));
listeners['carbon:joint-view']({detail:{date:'2026-06-29',mixingWPerK:5000,index:191}});
assert.match(get('spaceContext').textContent,/6月29日 · 5000 W\/K · 22:25—22:30/);
assert.equal(get('spaceTimeLabel').textContent,'22:25—22:30');
assert.equal(get('spaceTimeRange').value,'191');
const later=space.cases.find(c=>c.date==='2026-06-29'&&c.mixingWPerK===5000).modes.predictive[191];
assert.equal(layers.occupancy.total,`${later[0].reduce((sum,n)=>sum+n,0)} 人（代理）`);
get('spaceMode').value='baseline';get('spaceMode').events.change();
assert.match(get('spaceContext').textContent,/22:25—22:30 · 日常基准/);
const baseline=space.cases.find(c=>c.date==='2026-06-29'&&c.mixingWPerK===5000).modes.baseline[191];
assert.equal(layers.lighting.total,`${baseline[1].reduce((sum,n)=>sum+n,0)} W · ${meters.cases.find(c=>c.date==='2026-06-29'&&c.mixingWPerK===5000).modes.baseline.points[191].tubesOn}根`);
get('jointDate').value='2026-07-01';
listeners['carbon:joint-unavailable']();
assert.match(get('spaceContext').textContent,/空间快照不可用/);
assert.deepEqual(Array.from(layers.occupancy.display),['—','—','—','—']);
get('spaceMode').value='predictive';get('spaceMode').events.change();
assert.match(get('spaceContext').textContent,/空间快照不可用/);
assert.deepEqual(Array.from(layers.occupancy.display),['—','—','—','—']);
get('jointDate').value='2026-06-30';
listeners['carbon:joint-view']({detail:{date:'2026-06-30',mixingWPerK:1000,index:31}});
assert.match(get('spaceContext').textContent,/6月30日 · 1000 W\/K · 09:05—09:10 · 预测协同/);
assert.notEqual(layers.occupancy.display[0],'—');
const frame=selected.modes.predictive[31];
const hottest=frame[2].reduce((best,value,i)=>frame[0][i]>0&&(best<0||value>frame[2][best])?i:best,-1);
const original=frame[2][hottest];
frame[2][hottest]=original+1;
listeners['carbon:joint-view']({detail:{date:'2026-06-30',mixingWPerK:1000,index:31}});
assert.match(get('spaceContext').textContent,/四区快照与分项回放不一致/);
assert.equal(get('spaceTimeLabel').textContent,'—');
assert.deepEqual(Array.from(layers.occupancy.display),['—','—','—','—']);
frame[2][hottest]=original;
listeners['carbon:joint-view']({detail:{date:'2026-06-30',mixingWPerK:1000,index:31}});
assert.match(get('spaceContext').textContent,/09:05—09:10 · 预测协同/);
assert.notEqual(layers.occupancy.display[0],'—');
console.log(JSON.stringify({passed:true,cases:space.cases.length,points:6*3*192}));
