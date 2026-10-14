'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),ctx=vm.createContext({});
for(const n of ['building-inputs','reservation-model','reservation-profile','environment-dataset','spatial-occupancy-model','spatial-thermal-model'])vm.runInContext(fs.readFileSync(`${root}/data/${n}.js`,'utf8'),ctx);
const m=vm.runInContext('spatialThermalModel',ctx),data=vm.runInContext('environmentDataset',ctx),artifact=vm.runInContext('reservationArtifact',ctx);
const plain=x=>JSON.parse(JSON.stringify(x)),sum=xs=>xs.reduce((a,b)=>a+b,0),near=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`),p=m.parameters();
near(sum(p.zones.map(z=>z.assumedAreaM2)),378);near(sum(p.zones.map(z=>z.windowAreaM2)),34.56);
assert.ok(p.zones.every(z=>z.areaMeasured===false));near(p.zones[2].windowAreaM2,0);near(p.zones[3].windowAreaM2,0);
for(const shares of p.coolingShares){near(sum(shares),1);assert.ok(shares.every(x=>x>0));}
const west=m.cooling('west',1,p),east=m.cooling('east',1,p),both=m.cooling('both',1,p),off=m.cooling('off',1,p);
near(sum(west.zoneCoolingW),21000);near(sum(east.zoneCoolingW),21000);near(sum(both.zoneCoolingW),42000);
near(west.hvacInputKw,9.18);near(east.hvacInputKw,9.18);near(both.hvacInputKw,18.36);near(off.hvacInputKw,0);
assert.ok(west.zoneCoolingW.every(q=>q>0));assert.ok(west.zoneCoolingW[0]>west.zoneCoolingW[1]);assert.ok(east.zoneCoolingW[1]>east.zoneCoolingW[0]);
assert.throws(()=>m.parameters({westAreaFraction:.2,windowWestFraction:.9}));
near(m.cooling('both',0,p).hvacInputKw,0);near(m.cooling('west',undefined,p).fraction,.3);
for(const bad of [{massMultiplier:0},{mixingWPerK:-1},{ownSegmentShare:1},{southAreaFraction:0},{ach:NaN},{shr:'0.75'}])assert.throws(()=>m.parameters(bad));
for(const fraction of [-1,2,NaN,'0.3'])assert.throws(()=>m.cooling('both',fraction,p));assert.throws(()=>m.cooling('not-a-state',.3,p));
const r=data.records.find(r=>r.date==='2026-06-29'&&r.slot===15),weather={outdoorTemperatureC:24,southVerticalIrradianceWm2:0};
const isolated={...m.parameters({ach:0,glassU:0,opaqueU:0,mixingWPerK:0}),lightingTotalW:0};
// Analytical constant-flux limit, independent of the matrix implementation.
const heat=m.step([24,24,24,24],weather,[10,0,0,0],'off',0,isolated,60);
near(heat.temperaturesC[0],24+10*78*60/isolated.zones[0].capacityJPerK);near(heat.temperaturesC[1],24);
near(heat.ledger.storedJ,10*78*60);near(heat.ledger.residualJ,0,1e-6);
// No gains/boundaries/cooling: mixing must redistribute energy, never create it.
const closed={...m.parameters({ach:0,glassU:0,opaqueU:0,mixingWPerK:5000,massMultiplier:1,southAreaFraction:.4,westAreaFraction:.6}),lightingTotalW:0};
const initial=[30,20,26,22],mixed=m.step(initial,weather,[0,0,0,0],'off',0,closed,300);
near(sum(closed.zones.map((z,i)=>z.capacityJPerK*(mixed.temperaturesC[i]-initial[i]))),0,1e-6);
assert.ok(mixed.temperaturesC.every(t=>t>=20&&t<=30));near(sum(mixed.zones.map(z=>z.mixingW)),0,1e-7);
assert.ok(Math.max(...mixed.temperaturesC)-Math.min(...mixed.temperaturesC)<10);
const solar=m.gains({outdoorTemperatureC:29,southVerticalIrradianceWm2:300},[0,0,0,0],p);
near(solar[2].solarW,0);near(solar[3].solarW,0);near(sum(solar.map(z=>z.solarW)),34.56*.7*300);near(sum(solar.map(z=>z.lightsW)),756);
assert.throws(()=>m.gains(weather,[71,0,0,0],p));assert.throws(()=>m.gains(weather,[1.5,0,0,0],p));
let cases=0,maxResidual=0;
for(const ownSegmentShare of [.5,.7,.85])for(const mixingWPerK of [0,300,1000])for(const massMultiplier of [1,10,20])for(const mode of m.modes){
  const local=m.parameters({ownSegmentShare,mixingWPerK,massMultiplier}),res=m.step([23.4,25,24,27],r,[40,0,40,0],mode.id,.3,local);cases++;
  maxResidual=Math.max(maxResidual,Math.abs(res.ledger.residualJ));near(res.ledger.residualJ,0,1e-5);
  for(const zone of res.zones)near(zone.balanceResidualJ,0,1e-5);
  near(sum(res.zoneCoolingW),sum(res.unitCoolingW));near(res.hvacKwh,res.hvacInputKw/60);
}
const frozen=JSON.stringify(artifact),input={currentPeople:80,currentPattern:'west',initialTemperaturesC:[24,24,24,24],minutes:60};
const preview=m.preview(r,artifact,input);assert.equal(preview.modes.length,4);assert.equal(preview.demand.future.totalPeople,90);
assert.deepEqual(plain(preview.segments[0].counts),[40,0,40,0]);assert.deepEqual(plain(preview.segments[1].counts),[45,0,45,0]);
assert.ok(preview.segments.every(s=>s.record===r));assert.equal(JSON.stringify(artifact),frozen);
for(const result of preview.modes){near(result.minutes,60);near(result.ledger.residualJ,0,1e-4);assert.equal(result.isControlStrategy,false);assert.equal(result.isMeasured,false);assert.equal(Object.hasOwn(result,'savingPct'),false);}
const altered={...r,nextActualPeople:314,nextZoneTemperatures:[10,45,10,45],nextOutdoorTemperatureC:45};
assert.deepEqual(plain(m.preview(altered,artifact,input).modes),plain(preview.modes));
assert.throws(()=>m.preview({...r,slot:47},artifact,{...input,minutes:60}));
const noPeople=m.simulate([{record:weather,counts:[0,0,0,0],seconds:1800}],p,{modeId:'off'});assert.equal(noPeople.withinRangePct,null);assert.ok(noPeople.ledger.lightsJ>0);
const cold=m.simulate([{record:weather,counts:[10,0,0,0],seconds:1800}],isolated,{modeId:'both',averageCoolingFraction:1});assert.ok(cold.finalTemperaturesC[0]<23);assert.ok(cold.coldDegreeMinutes>0,'Do not hide overcooling by clipping');
const hot=m.simulate([{record:weather,counts:[10,0,0,0],seconds:60}],isolated,{modeId:'off',initialTemperaturesC:[27,24,24,24]});assert.ok(hot.peakOccupiedC>=27);assert.equal(hot.withinRangePct,0);
// Reducing numerical step size must converge to the same continuous trajectory.
const seg=[{record:r,counts:[40,0,40,0],seconds:1800}],run=dt=>m.simulate(seg,m.parameters({timeStepSeconds:dt}),{modeId:'west',averageCoolingFraction:.3});
const t60=run(60),t30=run(30),t15=run(15),error=(a,b)=>Math.max(...a.finalTemperaturesC.map((t,i)=>Math.abs(t-b.finalTemperaturesC[i])));
assert.ok(error(t30,t15)<error(t60,t15));assert.ok(error(t60,t15)<.02);near(t60.hvacKwh,t15.hvacKwh);
const sensitivity=m.sensitivity(seg,input);assert.equal(sensitivity.caseCount,35);assert.equal(sensitivity.trajectoryCount,140);
assert.ok(sensitivity.results.every(s=>s.modes.every(v=>v.maxStepResidualJ<1e-5)));
// Same cooling maps at share=0.5 => west/east labels are physically interchangeable.
const same=m.preview(r,artifact,{...input,minutes:30,ownSegmentShare:.5});
assert.deepEqual(plain(same.modes[1].finalTemperaturesC),plain(same.modes[2].finalTemperaturesC));
const benefit=k=>{const out=m.preview(r,artifact,{...input,minutes:30,mixingWPerK:k});return sum([0,2].map(i=>out.modes[2].finalTemperaturesC[i]-out.modes[1].finalTemperaturesC[i]))/2;};
assert.ok(benefit(50)>benefit(1000)&&benefit(1000)>0,'Stronger mixing must reduce directional benefit in symmetric benchmark');
const html=fs.readFileSync(`${root}/spatial-thermal-preview.html`,'utf8'),panel=fs.readFileSync(`${root}/data/spatial-thermal-panel.js`,'utf8');new vm.Script(panel);
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
for(const match of panel.matchAll(/(?:get|write)\('([^']+)'\s*[,)]/g))assert.ok(ids.includes(match[1]),`Missing field ${match[1]}`);
for(let i=0;i<4;i++)assert.ok(ids.includes('thermalT'+i));
for(const link of html.matchAll(/(?:src|href)="(data\/[^"?#]+)(?:\?[^"#]*)?"/g))assert.ok(fs.existsSync(path.join(root,link[1])));
assert.ok(!html.includes('data/zone-lighting-model.js')&&!html.includes('data/control-scenario-model.js'));
console.log(JSON.stringify({passed:true,balanceCases:cases,maxResidualJ:maxResidual,sensitivityCases:35,stepConvergenceMaxDifferenceC:error(t60,t15),noMeasuredOrSavingClaim:true,forecastSourceUnchanged:true}));
