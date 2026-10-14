'use strict';
// Small website adapter from the frozen fixed-lighting ablation. No replay is changed.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const input=fs.readFileSync(path.join(root,'evidence','forecast-fixed-light-ablation.json'));
const source=JSON.parse(input);
assert.equal(source.id,'CARBON-FIXED-LIGHT-FORECAST-ABLATION-01');
assert.equal(source.cases.length,6);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const cases=source.cases.map(item=>{
  const real=item.modes.realtime,pred=item.modes.predictive,comparison=item.predictiveVsRealtime;
  assert.ok(Math.abs(pred.hvacKwh-real.hvacKwh-comparison.hvacDifferenceKwh)<1e-8);
  assert.equal(real.lightScheduleSha256,pred.lightScheduleSha256);
  return {date:item.date,mixingWPerK:item.mixingWPerK,
    realtimeHvacKwh:real.hvacKwh,predictiveHvacKwh:pred.hvacKwh,
    predictiveMinusRealtimeKwh:comparison.hvacDifferenceKwh,
    bothTemperaturePass:real.temperaturePass&&pred.temperaturePass,
    terminalDifferenceC:comparison.terminalDifferenceC,
    temperatureComparable:comparison.temperatureComparable,
    forecastSelectedCount:pred.forecastSelectedCount,
    sameStateCommandChanges:pred.sameStateCommandChanges,
    qualifiedSavingPct:null};
});
const payload={version:'20261014-fixed-light-contribution-local',
  sourceAblationSha256:sha(input),
  scope:'42 fixed-on lamps, same person proxy, weather, initial state and four-zone heat model; HVAC policy differs.',
  limits:'Model-only nominal HVAC electricity. No all-seat 300 lx service, measured indoor temperature, actual floor occupancy, measured power or independent validation.',
  cases};
const output=`'use strict';\nwindow.CarbonForecastContributionEvidence=${JSON.stringify(payload)};\n`;
const file=path.join(root,'data','joint-forecast-contribution-data.js');
if(process.argv.includes('--write')){
  fs.writeFileSync(file,output,{flag:'wx'});
  console.log(`Created ${file}`);
}else{
  assert.ok(fs.readFileSync(file).equals(Buffer.from(output)),'Website forecast contribution differs from frozen ablation');
  console.log(JSON.stringify({passed:true,cases:cases.length,sourceAblationSha256:payload.sourceAblationSha256,
    outputSha256:sha(output)},null,2));
}
