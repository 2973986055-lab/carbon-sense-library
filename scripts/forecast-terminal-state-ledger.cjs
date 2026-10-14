'use strict';
// Diagnose thermal-state differences in the frozen fixed-lighting ablation.
// This is stored sensible heat, not an electricity or recovery-energy estimate.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const ablationFile=path.join(root,'evidence','forecast-fixed-light-ablation.json');
const ledgerFile=path.join(root,'evidence','forecast-terminal-state-ledger.json');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const read=file=>fs.readFileSync(file);
const sourceNames=['building-inputs','spatial-occupancy-model','spatial-thermal-model'];
const ablationBytes=read(ablationFile),ablation=JSON.parse(ablationBytes);
assert.equal(ablation.id,'CARBON-FIXED-LIGHT-FORECAST-ABLATION-01');
assert.equal(ablation.cases.length,6);

const context=vm.createContext({});
for(const name of sourceNames){
  const bytes=read(path.join(root,'data',`${name}.js`));
  assert.equal(hash(bytes),ablation.modelSourceSha256[name],`Model source changed: ${name}`);
  vm.runInContext(bytes.toString('utf8'),context,{filename:`${name}.js`});
}
const thermal=vm.runInContext('spatialThermalModel',context);
const sum=values=>values.reduce((total,value)=>total+value,0);
const massMultipliers=[5,10,20];
const cases=ablation.cases.map(c=>{
  const realtime=c.modes.realtime,predictive=c.modes.predictive;
  const replayBytes=read(path.join(root,'evidence','joint-replays',c.sourceReplay));
  assert.equal(hash(replayBytes),c.sourceReplaySha256,`Original replay changed: ${c.sourceReplay}`);
  const frozen=JSON.parse(replayBytes);
  assert.equal(realtime.finalTemperaturesC.length,4);
  assert.equal(predictive.finalTemperaturesC.length,4);
  assert.equal(realtime.lightScheduleSha256,predictive.lightScheduleSha256);
  const deltaC=realtime.finalTemperaturesC.map((temperature,i)=>predictive.finalTemperaturesC[i]-temperature);
  const sensitivities=massMultipliers.map(massMultiplier=>{
    const p=thermal.parameters({mixingWPerK:c.mixingWPerK,massMultiplier});
    const byZoneKwhThermal=p.zones.map((zone,i)=>zone.capacityJPerK*deltaC[i]/3600000);
    const totalKwhThermal=sum(byZoneKwhThermal);
    assert.ok(Math.abs(totalKwhThermal-sum(deltaC.map((difference,i)=>p.zones[i].capacityJPerK*difference))/3600000)<1e-10);
    return {massMultiplier,totalHeatCapacityKwhThermalPerK:p.totalCapacityJPerK/3600000,
      byZoneKwhThermal,totalKwhThermal};
  });
  const defaultParameters=thermal.parameters({mixingWPerK:c.mixingWPerK,massMultiplier:10});
  const baselineStoredKwh=sum(defaultParameters.zones.map((zone,i)=>
    zone.capacityJPerK*(c.modes.baseline.finalTemperaturesC[i]-24)))/3600000;
  assert.ok(Math.abs(baselineStoredKwh-frozen.modes.baseline.storedChangeKwhThermal)<1e-9,
    `Baseline thermal storage differs from original replay: ${c.sourceReplay}`);
  assert.ok(Math.abs(sensitivities[0].totalKwhThermal*2-sensitivities[1].totalKwhThermal)<1e-10);
  assert.ok(Math.abs(sensitivities[1].totalKwhThermal*2-sensitivities[2].totalKwhThermal)<1e-10);
  return {date:c.date,mixingWPerK:c.mixingWPerK,finalTemperatureDifferencePredictiveMinusRealtimeC:deltaC,
    maximumAbsoluteDifferenceC:Math.max(...deltaC.map(Math.abs)),
    nominalHvacDifferencePredictiveMinusRealtimeKwh:c.predictiveVsRealtime.hvacDifferenceKwh,
    bothTemperaturePass:realtime.temperaturePass&&predictive.temperaturePass,
    terminalComparable:c.predictiveVsRealtime.temperatureComparable,
    storedSensibleHeatSensitivity:sensitivities};
});
const result={id:'CARBON-FORECAST-TERMINAL-LEDGER-01',version:'20261014-local',
  sourceAblationSha256:hash(ablationBytes),
  calculation:'sum over four zones of C_zone × (T_predictive_end − T_realtime_end) / 3,600,000 J/kWh',
  capacitySource:'Uncalibrated equivalent air-and-building thermal mass in spatial-thermal-model.js.',
  defaultMassMultiplier:10,sensitivityMultipliers:massMultipliers,
  sensitivityMeaning:'The 5× and 20× columns hold the frozen 10× terminal temperatures fixed; they change only the heat-capacity accounting, not controller decisions or trajectories.',
  interpretation:'Positive heat means the predictive run ends warmer; it does not equal deferred electricity or required next-day cooling.',
  noRecoveryCalculation:true,noCopElectricityConversion:true,noQualifiedSavingPct:true,cases};
const output=JSON.stringify(result,null,2)+'\n';
if(process.argv.includes('--write')){
  fs.writeFileSync(ledgerFile,output,{flag:'wx'});
  console.log(`Created ${ledgerFile}`);
}else{
  assert.ok(read(ledgerFile).equals(Buffer.from(output)),'Frozen terminal ledger differs from recomputation');
  console.log(JSON.stringify({passed:true,sourceAblationSha256:result.sourceAblationSha256,
    cases:cases.map(c=>({date:c.date,mixingWPerK:c.mixingWPerK,
      defaultHeatDifferenceKwhThermal:c.storedSensibleHeatSensitivity[1].totalKwhThermal,
      maximumAbsoluteDifferenceC:c.maximumAbsoluteDifferenceC,
      terminalComparable:c.terminalComparable})),artifactSha256:hash(output)},null,2));
}
