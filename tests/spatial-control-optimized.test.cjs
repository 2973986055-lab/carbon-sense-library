'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),root=__dirname+'/..',ctx=vm.createContext({});
for(const n of ['building-inputs','reservation-model','reservation-profile','environment-dataset','spatial-occupancy-model','spatial-thermal-model','spatial-control-model','spatial-control-optimized'])vm.runInContext(fs.readFileSync(root+'/data/'+n+'.js','utf8'),ctx);
const m=vm.runInContext('spatialControlOptimized',ctx),old=vm.runInContext('spatialControlModel',ctx),th=vm.runInContext('spatialThermalModel',ctx),d=vm.runInContext('environmentDataset',ctx),a=vm.runInContext('reservationArtifact',ctx);
const near=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`),sum=x=>x.reduce((a,b)=>a+b,0),plain=x=>JSON.parse(JSON.stringify(x));
const pl=m.plant({mixingWPerK:5000}),r=d.records.find(r=>r.date==='2026-06-29'&&r.slot===20);
assert.equal(pl.settings.airflowM3h,null);assert.equal(pl.settings.indoorFanKw,0);assert.equal(pl.settings.fanPowerVerified,false);
assert.equal(pl.parameters.settings.mixingWPerK,5000);assert.equal(m.plant().parameters.settings.mixingWPerK,300);
assert.equal(pl.settings.minimumOnMinutes,10);assert.equal(pl.settings.minimumOffMinutes,10);
for(const bad of [{indoorFanKw:-1},{startupWh:200},{economyTargetC:24.2},{minimumOnMinutes:3}])assert.throws(()=>m.plant(bad));
let balanceCases=0;
for(const mask of [0,1,2,3])for(const served of [5,15])for(const temps of [[24,24,24,24],[26,24,25,23.2],[23.9,23.9,23.9,23.9]]){
  const counts=[40,0,40,0],out=pl.advance(temps,r,counts,mask,served,23.9,true);balanceCases++;
  assert.ok(out.fractions.every((f,i)=>f>=0&&f<=1&&(mask&(1<<i)||f===0)));
  near(sum(out.zoneCoolingW),sum(out.unitCoolingW));near(out.ledger.residualJ,0,1e-5);
  // Linear superposition independently reproduces the accepted integrator.
  const free=th.step(temps,r,counts,'off',0,pl.parameters).temperaturesC,w=th.step(temps,r,counts,'west',out.fractions[0],pl.parameters).temperaturesC,e=th.step(temps,r,counts,'east',out.fractions[1],pl.parameters).temperaturesC;
  out.temperaturesC.forEach((t,i)=>near(t,w[i]+e[i]-free[i],1e-10));
}
// Independently validate feasibility: if a grid point can maintain constraints,
// the polygon solver cannot claim every candidate violates those constraints.
let feasibleChecks=0;
for(const temps of [[23.8,23.8,23.8,23.8],[24,24,24,24],[24.05,23.6,23.8,23.3]]){
  const counts=[40,0,40,0],free=pl.free(temps,r,counts),out=pl.advance(temps,r,counts,3,5,23.9);let feasible=false;
  for(let x=0;x<=20;x++)for(let y=0;y<=20;y++){const ts=free.map((t,i)=>t-pl.response[0][i]*x/20-pl.response[1][i]*y/20);if(ts.every((t,i)=>counts[i]>0?t>=23&&t<=24:t>=20&&t<=28))feasible=true;}
  if(feasible){feasibleChecks++;out.temperaturesC.forEach((t,i)=>assert.ok(counts[i]>0?t>=23-1e-7&&t<=24+1e-7:t>=20-1e-7&&t<=28+1e-7));}
}
assert.ok(feasibleChecks>0);
const rows=d.records.filter(r=>r.date==='2026-06-29'),input={mixingWPerK:5000},hash=JSON.stringify(a),result=m.simulateDay(rows,a,input),ablation=m.ablation(rows,a,input);
assert.equal(JSON.stringify(a),hash);
assert.ok(result.modes[2].maximumOccupiedViolationC<1e-6);assert.ok(result.modes[2].maximumTerminalTemperatureDifferenceC<=.05);assert.ok(result.modes[2].savingPct>0);
for(const mode of result.modes){near(mode.hvacKwh,sum(mode.trace.map(t=>t.hvacKwh))+mode.startupSensitivityKwh);near(mode.ledger.residualJ,0,1e-3);assert.ok(mode.maxBalanceResidualJ<1e-5);
  assert.ok(mode.trace.every(t=>t.targetTemperatureC>=23&&t.targetTemperatureC<=24));
  for(let u=0;u<2;u++){let on=false,last=-Infinity;for(const dec of mode.decisions){const next=Boolean(dec.mask&(1<<u));if(next!==on){assert.ok(dec.minute-last>=10);on=next;last=dec.minute;}}if(on)assert.ok(result.settings.endMinute-last>=10);}
  assert.ok(mode.trace.filter(t=>t.minute>=1320).every(t=>t.targetTemperatureC===23.6));
  assert.equal(mode.isMeasured,false);
}
const differences=result.modes[2].trace.filter((t,i)=>t.requestMask!==ablation.trace[i].requestMask||t.targetTemperatureC!==ablation.trace[i].targetTemperatureC||Math.abs(t.hvacKw-ablation.trace[i].hvacKw)>1e-7).length;assert.ok(differences>0);
const modified=rows.map(r=>r.slot>=30?{...r,floorReservationProxy:314,outdoorTemperatureC:40,southVerticalIrradianceWm2:1000}:r),future=m.simulateDay(modified,a,input);
for(let policy=0;policy<3;policy++)for(let i=0;i<result.modes[policy].trace.length;i++)if(result.modes[policy].trace[i].minute<900){const t=result.modes[policy].trace[i],f=future.modes[policy].trace[i];assert.equal(t.requestMask,f.requestMask);assert.equal(t.targetTemperatureC,f.targetTemperatureC);t.temperaturesC.forEach((v,j)=>near(v,f.temperaturesC[j]));}
const weak=m.simulateDay(rows,a);assert.ok(weak.modes.every(x=>x.maximumOccupiedViolationC>1));assert.ok(weak.modes.every(x=>x.savingPct===null));
const fan=m.simulateDay(rows,a,{...input,indoorFanKw:.3,startupWh:10,startMinute:390,endMinute:450});
for(const mode of fan.modes){near(mode.hvacKwh,mode.coolingAndFanKwh+mode.startupSensitivityKwh);assert.ok(mode.startupSensitivityKwh>=.01);}
const html=fs.readFileSync(root+'/spatial-control-optimized-preview.html','utf8'),panel=fs.readFileSync(root+'/data/spatial-control-optimized-panel.js','utf8');new vm.Script(panel);
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
for(const match of panel.matchAll(/(?:get|write)\('([^']+)'\s*[,)]/g))assert.ok(ids.includes(match[1]),`Missing ${match[1]}`);
for(const link of html.matchAll(/(?:src|href)="(data\/[^"?#]+)(?:\?[^"#]*)?"/g))assert.ok(fs.existsSync(root+'/'+link[1]));
console.log(JSON.stringify({passed:true,balanceCases,feasibleChecks,forecastChangesMinutes:differences,defaultPhysicalFailureRetained:true,restorationIncluded:true,airflowUnknown:true}));
