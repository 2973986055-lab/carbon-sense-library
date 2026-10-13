'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..'),context=vm.createContext({});
for(const file of ['building-inputs.js','thermal-model.js','environment-dataset.js','reservation-model.js','reservation-profile.js']) {
  vm.runInContext(fs.readFileSync(path.join(root,'data',file),'utf8'),context);
}
const get=name=>vm.runInContext(name,context);
const model=get('thermalModel'),inputs=get('buildingInputs'),data=get('environmentDataset');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
assert.equal(data.sourceYear,2026);assert.equal(data.version,3);
assert.equal(data.records.length,336);assert.equal(data.daily.length,7);
assert.equal(new Set(data.records.map(r=>r.timestamp)).size,336);
assert.equal(inputs.geometry.windowTotalWidthM,14.4);
near(inputs.geometry.windowAreaM2,14.4*2.4);
assert.equal(inputs.geometry.ceilingHeightM,null);
assert.equal(inputs.geometry.daytimeCurtains,'open');
assert.equal(inputs.assumptions.ceilingHeightM,3.5);
assert.equal(inputs.availableData.indoorTemperatureHumidityMeasured,false);
assert.equal(inputs.availableData.historicalElectricityObtainable,false);
for(const temperature of [12,22,24,28,34]) for(const rh of [0,20,55,90,100]) {
  near(model.relativeHumidity(temperature,model.humidityRatio(temperature,rh)),rh);
}
assert.throws(()=>model.humidityRatio(24,101));
assert.throws(()=>model.calculate({}));
let active=0,maxEnergy=0;
for(const record of data.records) {
  assert.ok(Number.isInteger(record.libraryReservations)&&record.libraryReservations>=0);
  assert.ok(Number.isInteger(record.floorReservationProxy)&&record.floorReservationProxy>=0&&record.floorReservationProxy<=314);
  assert.ok(Number.isFinite(record.southVerticalIrradianceWm2)&&record.southVerticalIrradianceWm2>=0);
  const result=model.compare(record),baseline=result.baseline;
  assert.ok(Number.isFinite(baseline.energyKwh)&&baseline.energyKwh>=0);
  assert.ok(baseline.coolingLoadRatio>=0&&baseline.coolingLoadRatio<=1);
  assert.ok(baseline.electricalEquivalentLoadRatio>=0&&baseline.electricalEquivalentLoadRatio<=1);
  near(baseline.hvacInputKw,18.36*baseline.electricalEquivalentLoadRatio);
  near(baseline.energyKwh,baseline.hvacKwh+baseline.lightingKwh);
  near(baseline.coolingLoadRatio,baseline.deliveredCoolingKw/56);
  assert.ok(baseline.electricalEquivalentLoadRatio>=baseline.coolingLoadRatio-1e-12);
  for(const mode of result.modes) {
    near(mode.energyKwh,baseline.energyKwh);near(mode.savedKwh,0);
    assert.equal(mode.savingPct,baseline.energyKwh===0?null:0);
  }
  if(baseline.active){active++;near(baseline.lightingInputKw,.756);}
  else {near(baseline.energyKwh,0);assert.equal(baseline.humidityEstimatePct,null);near(baseline.sensibleUnmetKw,0);}
  assert.ok(baseline.humidityEstimatePct===null||(baseline.humidityEstimatePct>=0&&baseline.humidityEstimatePct<=100));
  maxEnergy=Math.max(maxEnergy,baseline.energyKwh);
}
const selected=data.records.find(r=>r.date==='2026-06-29'&&r.time==='16:00');
assert.ok(selected);
const base=model.calculate(selected,{people:250});
const closed=model.calculate(selected,{people:250,curtainClosedFraction:1});
assert.ok(closed.heatGainsW.solar<base.heatGainsW.solar);
assert.ok(closed.energyKwh<base.energyKwh);
const dim=model.calculate(selected,{people:250,tubes:20});
assert.ok(dim.energyKwh<base.energyKwh);near(dim.lightingInputKw,.36);
const warmer=model.compare(selected,{people:250,optimizedSetpointC:26});
assert.ok(warmer.modes[1].savedKwh>0);
near(warmer.modes[1].energyKwh,warmer.modes[2].energyKwh);
const colder=model.compare(selected,{people:250,optimizedSetpointC:22});
assert.ok(colder.modes[1].savingPct<0,'Colder strategy must expose negative savings');
near(base.peopleMoistureKgPerHour,250*130*.4/2450000*3600);
const extreme=model.calculate({...selected,outdoorTemperatureC:45,southVerticalIrradianceWm2:2000},{people:314});
assert.equal(extreme.humidityEstimatePct,null);
assert.ok(extreme.sensibleUnmetKw>0);
assert.ok(extreme.flags.some(flag=>flag.includes('制冷能力不足')));
const zero=model.compare(selected,{people:0,acRunning:false,baselineTubes:0,optimizedTubes:0});
assert.ok(zero.modes.every(m=>m.energyKwh===0&&m.savingPct===null));
const noCooling=model.calculate({...selected,outdoorTemperatureC:12,southVerticalIrradianceWm2:0},{people:1,ach:3});
near(noCooling.hvacKwh,0);assert.ok(noCooling.lightingKwh>0);
const sensitivity=model.sensitivity(selected);
assert.equal(sensitivity.scenarios,16);
assert.ok(sensitivity.note.includes('不是统计置信区间'));
assert.ok(sensitivity.energyKwhRange[0]<=sensitivity.energyKwhRange[1]);
near(data.peopleValidationSummary.mae,14.95);
assert.equal(data.peopleValidationSummary.activeTargets,64);
const peopleModel=get('reservationModel'),artifact=get('reservationArtifact');
const daily=data.daily.map(day=>data.records.filter(r=>r.date===day.date).map(r=>r.libraryReservations));
const fit=peopleModel.fit(daily.slice(0,5));
assert.equal(Array.from(fit.profile).join(','),Array.from(artifact.profile).join(','));
near(peopleModel.score(fit,daily[5],'adjusted',artifact.weight).active.mae,14.90625);
near(peopleModel.score(fit,daily[6],'adjusted',artifact.weight).active.mae,14.99375);
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(ids).size,ids.length);
for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
const panel=fs.readFileSync(path.join(root,'data/climate-panel.js'),'utf8');new vm.Script(panel);
for(const match of panel.matchAll(/(?:get|text)\('([^']+)'/g)) assert.ok(ids.includes(match[1]),`Missing ID ${match[1]}`);
for(const id of ['climateDate','climateTime','climatePeople','climateHeight','climateAch','climateCurtain',
  'climateBaselineTemp','climateOperation','climateOptimizedTemp','climateOptimizedTubes','climateInitialRh','climateShr'])assert.ok(ids.includes(id));
const linkedScripts=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m=>new URL(m[1],'https://example.test/').pathname);
for(const script of ['building-inputs','thermal-model','environment-dataset','climate-panel'])assert.ok(linkedScripts.includes(`/data/${script}.js`));
assert.ok(html.indexOf('data/environment-dataset.js')<html.indexOf('data/climate-panel.js'));
const publicData=fs.readFileSync(path.join(root,'data/environment-dataset.js'),'utf8');
assert.ok(!publicData.includes('C:/Users/')&&!publicData.includes('C:\\\\Users\\\\'));
console.log(JSON.stringify({passed:true,records:336,activeScenarios:active,maxHalfhourEnergyKwh:maxEnergy,
  selected:{people:base.people,energyKwh:base.energyKwh,rhScenarioPct:base.humidityEstimatePct},
  sensitivityScenarios:sensitivity.scenarios,holdoutMae:data.peopleValidationSummary.mae},null,2));
