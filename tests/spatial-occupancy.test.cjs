'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),ctx=vm.createContext({});
for(const file of ['reservation-model','reservation-profile','environment-dataset','spatial-occupancy-model'])vm.runInContext(fs.readFileSync(path.join(root,'data',file+'.js'),'utf8'),ctx);
const model=vm.runInContext('spatialOccupancyModel',ctx),forecast=vm.runInContext('reservationModel',ctx),artifact=vm.runInContext('reservationArtifact',ctx),data=vm.runInContext('environmentDataset',ctx);
const plain=x=>JSON.parse(JSON.stringify(x));
// Independently checked against seat-plan numbering; old lamp groups are not geometry.
assert.deepEqual(plain(model.zones.map(z=>({id:z.id,range:z.seatIdRange,capacity:z.capacity}))),[
  {id:'south-west',range:[91,160],capacity:70},{id:'south-east',range:[1,90],capacity:90},
  {id:'north-west',range:[245,314],capacity:70},{id:'north-east',range:[161,244],capacity:84}
]);
const seats=model.zones.flatMap(z=>Array.from({length:z.seatIdRange[1]-z.seatIdRange[0]+1},(_,i)=>z.seatIdRange[0]+i));
assert.deepEqual(plain(seats).sort((a,b)=>a-b),Array.from({length:314},(_,i)=>i+1));
for(const z of model.zones){assert.equal(z.capacity,z.seatIdRange[1]-z.seatIdRange[0]+1);assert.equal(z.areaM2,null);assert.equal(z.directWindowBoundary,z.side==='south');}
assert.deepEqual(plain(model.geometry.orientation),{up:'west',down:'east',left:'south',right:'north'});
assert.deepEqual(plain(model.geometry.windowWalls),['south']);
assert.equal(model.geometry.floorAreaM2,378);assert.equal(model.geometry.floorAreaMeasured,false);
assert.equal(model.geometry.zoneAreasMeasured,false);assert.equal(model.geometry.lightingGroupMappingVerified,false);
let cases=0;
for(const pattern of Object.keys(model.patterns)) {
  let previous=[0,0,0,0];
  for(let people=0;people<=314;people++) {
    const counts=plain(model.allocate(people,pattern));cases++;
    assert.equal(counts.reduce((a,b)=>a+b,0),people);
    counts.forEach((n,i)=>{assert.ok(Number.isInteger(n)&&n>=0&&n<=model.zones[i].capacity);assert.ok(n>=previous[i]);});
    previous=counts;
  }
}
assert.deepEqual(plain(model.allocate(80,'window')),[35,45,0,0]);
assert.deepEqual(plain(model.allocate(90,'window')),[39,51,0,0]);
assert.deepEqual(plain(model.allocate(160,'window')),[70,90,0,0]);
assert.deepEqual(plain(model.allocate(161,'window')),[70,90,0,1]);
assert.deepEqual(plain(model.allocate(154,'inner')),[0,0,70,84]);
assert.deepEqual(plain(model.allocate(155,'inner')),[0,1,70,84]);
assert.deepEqual(plain(model.allocate(140,'west')),[70,0,70,0]);
assert.deepEqual(plain(model.allocate(174,'east')),[0,90,0,84]);
assert.deepEqual(plain(model.allocate(314,'east')),[70,90,70,84]);
for(const n of [-1,315,1.5,NaN,Infinity,'80',null])assert.throws(()=>model.allocate(n));
for(const pattern of ['unknown','toString','left','right'])assert.throws(()=>model.allocate(80,pattern));
const record=data.records.find(r=>r.date==='2026-06-29'&&r.slot===15),before=JSON.stringify(artifact);
const current=model.buildDemand(record,artifact,{currentPattern:'window'});
assert.equal(current.version,2);assert.equal(current.currentSource,'registered_proxy');assert.equal(current.current.totalPeople,27);
assert.equal(current.future.totalPeople,forecast.transfer(artifact,15,27).people);assert.equal(current.future.totalPeople,64);
const manual=model.buildDemand(record,artifact,{currentPeople:80,currentPattern:'window'});
assert.equal(manual.currentSource,'manual_scenario');assert.equal(manual.future.totalPeople,90);
assert.equal(manual.future.pattern,'window');assert.equal(manual.allocationRuleChanged,false);
const movement=model.buildDemand(record,artifact,{currentPeople:80,currentPattern:'window',futurePattern:'inner'});
assert.equal(movement.future.totalPeople,manual.future.totalPeople);assert.equal(movement.allocationRuleChanged,true);
assert.equal(movement.changes.filter(z=>z.state==='scenario_entry').length,2);
assert.equal(movement.changes.filter(z=>z.state==='scenario_exit').length,2);
assert.equal(movement.changes.reduce((s,z)=>s+z.difference,0),movement.future.totalPeople-movement.current.totalPeople);
// Returned seat ranges are copies, so UI consumers cannot alter shared geometry.
manual.current.zones[0].seatIdRange.push(999);assert.equal(model.zones[0].seatIdRange.includes(999),false);
assert.equal(JSON.stringify(artifact),before);
// Only frozen profiles and current inputs enter the next total, never future truth.
const recordsChanged=data.records.map(r=>r.date===record.date&&r.slot>15?{...r,floorReservationProxy:314,outdoorTemperatureC:45}:r);
assert.deepEqual(plain(model.buildDemand(recordsChanged.find(r=>r.date===record.date&&r.slot===15),artifact,{currentPattern:'window'})),plain(current));
const altered={...record,nextActualPeople:314,nextZoneOccupancy:[70,90,70,84]};
assert.deepEqual(plain(model.buildDemand(altered,artifact,{currentPattern:'window'})),plain(current));
const boundary=model.buildDemand({...record,slot:47},artifact);
assert.equal(boundary.future,null);assert.equal(boundary.forecastAvailable,false);assert.equal(boundary.changes,null);
assert.equal(boundary.time,'23:30');assert.ok(boundary.forecastUnavailableReason);
for(const r of [{...record,slot:48},{...record,slot:-1},{...record,date:'bad'}])assert.throws(()=>model.buildDemand(r,artifact));
for(const r of data.records)for(const pattern of Object.keys(model.patterns)) {
  const result=model.buildDemand(r,artifact,{currentPattern:pattern});
  if(result.future){assert.equal(result.future.totalPeople,forecast.transfer(artifact,r.slot,r.floorReservationProxy).people);assert.equal(result.future.counts.reduce((a,b)=>a+b,0),result.future.totalPeople);}
  assert.equal(Object.hasOwn(result,'hvacKwh'),false);assert.equal(Object.hasOwn(result,'temperatureC'),false);
}
const html=fs.readFileSync(path.join(root,'spatial-occupancy-preview.html'),'utf8'),panel=fs.readFileSync(path.join(root,'data/spatial-occupancy-panel.js'),'utf8'),css=fs.readFileSync(path.join(root,'data/spatial-occupancy-panel.css'),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
for(const match of panel.matchAll(/(?:get|write|drawMap)\('([^']+)'/g))assert.ok(ids.includes(match[1]),`Missing preview field ${match[1]}`);
for(const link of html.matchAll(/(?:src|href)="(data\/[^"?#]+)(?:\?[^"#]*)?"/g))assert.ok(fs.existsSync(path.join(root,link[1])));
const scriptPaths=[...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(m=>new URL(m[1],'https://example.test/').pathname);
assert.equal(scriptPaths.includes('/data/zone-lighting-model.js'),false);
assert.ok(scriptPaths.indexOf('/data/spatial-occupancy-model.js')>scriptPaths.indexOf('/data/reservation-model.js'));
assert.ok(scriptPaths.indexOf('/data/spatial-occupancy-panel.js')>scriptPaths.indexOf('/data/spatial-occupancy-model.js'));
assert.ok(!html.includes('value="left"')&&!html.includes('value="right"')&&!html.includes('class="window-band"'));
assert.ok(html.includes('西 · 图上')&&html.includes('东 · 图下')&&html.includes('北侧 · 无外窗'));
for(const [id,col,row] of [['south-west',1,1],['south-east',1,2],['north-west',2,1],['north-east',2,2]])assert.ok(css.includes(`.zone-cell.${id}{grid-column:${col};grid-row:${row}}`));
new vm.Script(panel);
console.log(JSON.stringify({passed:true,geometryVersion:2,onlySouthWindows:true,capacities:[70,90,70,84],seatIdsCovered:314,allocationCases:cases,historicalSnapshots:data.records.length*5,registeredExample:{current:current.current.totalPeople,future:current.future.totalPeople},manualExample:{current:80,future:90},noTemperatureOrEnergy:true}));