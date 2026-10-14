'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto'),ctx=vm.createContext({}),root=__dirname+'/..';
for(const name of ['building-inputs','reservation-model','reservation-profile','spatial-occupancy-model','spatial-thermal-model','environment-dataset','hvac-response-model','hvac-predictive-model','hvac-supervisory-model'])vm.runInContext(fs.readFileSync(root+'/data/'+name+'.js','utf8'),ctx);
const s=vm.runInContext('hvacSupervisoryModel',ctx),p=vm.runInContext('hvacResponseModel',ctx),m=vm.runInContext('hvacPredictiveModel',ctx),a=vm.runInContext('reservationArtifact',ctx),env=vm.runInContext('environmentDataset',ctx),near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const protocol=JSON.parse(fs.readFileSync(root+'/data/hvac-evaluation-protocol.json','utf8'));
for(const f of protocol.inputHashes)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(root+'/'+f.path)).digest('hex'),f.sha256);
assert.equal(protocol.controller.permissionHoldMinutes,s.defaults.permissionHoldMinutes);assert.equal(protocol.controller.setpointHoldMinutes,s.defaults.setpointHoldMinutes);assert.equal(protocol.controller.guardMarginC,s.defaults.guardMarginC);assert.equal(protocol.informationControls.formalComparisonStarted,false);
let mem=s.observeSlot(s.memory(),13,[0,0,0,0]);for(let i=0;i<5;i++)mem=s.observeSlot(mem,13,[0,0,0,0]);assert.equal(mem.emptyRuns[0],1);
mem=s.observeSlot(mem,14,[0,0,0,0]);assert.equal(mem.emptyRuns[0],2);assert.equal(mem.emptyRuns[1],2);assert.equal(s.observeSlot(mem,15,[1,0,0,0]).emptyRuns[0],0);assert.equal(s.observeSlot(mem,16,[0,0,0,0]).emptyRuns[0],1);assert.throws(()=>s.observeSlot(mem,12,[0,0,0,0]));
// A stable trajectory does not cause new high-level commands.
const config=s.settings(),pl=p.plant(),state=pl.initial([23.5,23.5,23.5,23.5]),record={slot:13,date:'2026-06-29',outdoorTemperatureC:23.5,southVerticalIrradianceWm2:0};
const stable={hotZones:[],coldZones:[],emptyHigh:false,emptyLow:false,currentGroupPeople:[1,1],futureGroupPeople:[1,1],futureUsed:false};
assert.equal(s.allowed(state,390,config,stable,s.memory()).length,1);assert.equal(s.allowed(state,390,config,stable,s.memory())[0].id,'off_off');
// Stricter supervisory hold is distinct from original machine protection.
const on=p.actions.find(c=>c.id==='23_23'),after=pl.step(pl.initial([26,26,26,26]),record,[10,10,10,10],on).state;
assert.ok(s.legal({...after,elapsedSeconds:900},405,config).every(c=>c.id==='23_23'));assert.ok(s.legal({...after,elapsedSeconds:1200},410,config).some(c=>c.id==='24_24'));
assert.ok(s.legal(pl.initial(),1340,config).every(c=>c.id==='off_off'));
const hot={...stable,hotZones:[0]};assert.ok(s.allowed(state,390,config,hot,s.memory()).some(c=>c.id==='23_off'));
const emptySignal={...stable,currentGroupPeople:[0,0],futureGroupPeople:[0,0],futureUsed:true};assert.ok(!s.allowed({...after,elapsedSeconds:1200},410,config,emptySignal,s.observeSlot(s.memory(),13,[0,0,0,0])).some(c=>c.id==='off_off'));
assert.ok(s.allowed({...after,elapsedSeconds:1200},410,config,emptySignal,mem).some(c=>c.id==='off_off'));
// Forecasted empty slots cannot be counted as observed empty slots inside planning.
const beforeMem=JSON.stringify(mem),pr=m.projection(record,a,415,[0,0,0,0],config);s.probe(state,pr,0,pl,config);assert.equal(JSON.stringify(mem),beforeMem);
const synthetic={floorMapping:{coefficient:1},floorWeight:0,floorProfile:Array(48).fill(200),profile:Array(48).fill(200)},arrivalWeather={...record,outdoorTemperatureC:29,southVerticalIrradianceWm2:100};
let leaked=0;Object.defineProperty(arrivalWeather,'futureActualPeople',{get(){leaked++;throw new Error('Future actual leak');}});
const diag=p.plant({mixingWPerK:5000}),pred=s.decision(diag.initial(),arrivalWeather,[0,0,0,0],415,synthetic,diag,s.memory(),{mixingWPerK:5000}),hold=s.decision(diag.initial(),arrivalWeather,[0,0,0,0],415,synthetic,diag,s.memory(),{mixingWPerK:5000,forecastMode:'persistence'});
assert.equal(leaked,0);assert.notEqual(pred.command.id,hold.command.id);assert.equal(hold.command.id,'off_off');assert.equal(pred.terminalEquivalentObjectiveKwh,0);
// An energy tie after observed vacancy releases the permission; one slot cannot.
const emptyArtifact={floorMapping:{coefficient:1},floorWeight:0,floorProfile:Array(48).fill(0),profile:Array(48).fill(0)},emptyRecord={...record,slot:14};
let vacantState=diag.step(diag.initial([26,26,26,26]),emptyRecord,[0,0,0,0],p.actions.find(c=>c.id==='23_off')).state;vacantState={...vacantState,elapsedSeconds:2700,temperaturesC:[23.5,23.5,23.5,23.5]};
const confirmed=s.observeSlot(s.observeSlot(s.memory(),13,[0,0,0,0]),14,[0,0,0,0]),single=s.observeSlot(s.memory(),14,[0,0,0,0]);
assert.equal(s.decision(vacantState,emptyRecord,[0,0,0,0],435,emptyArtifact,diag,confirmed,{mixingWPerK:5000}).command.id,'off_off');
assert.equal(s.decision(vacantState,emptyRecord,[0,0,0,0],435,emptyArtifact,diag,single,{mixingWPerK:5000}).command.id,'23_off');
// Independent physical replay of a chosen sequence with its declared holds.
let st=diag.initial(),energy=0,elapsed=0;for(const c of pred.best.sequence){assert.ok(s.legal(st,415+elapsed/60,s.settings({mixingWPerK:5000})).some(x=>x.id===c.id));for(let k=0;k<20;k++){const out=diag.step(st,pred.projection.weather,m.countsAt(pred.projection,elapsed),c,15);energy+=out.hvacKwh;st=out.state;elapsed+=15;}}
near(energy,pred.best.metrics.energyKwh);st.temperaturesC.forEach((t,i)=>near(t,pred.best.state.temperaturesC[i]));
const records=env.records.filter(r=>r.date==='2026-06-29'),run=s.runDay(records,a,{startMinute:390,endMinute:450});
assert.equal(run.decisions.length,12);assert.equal(run.trace.length,240);assert.equal(run.savingPct,null);assert.ok(run.maxBalanceResidualJ<1e-5);near(run.hvacKwh,run.unitOnMinutes.reduce((x,y)=>x+y,0)*9.18/60);
const again=s.runDay(records,a,{startMinute:390,endMinute:450});assert.equal(JSON.stringify(run),JSON.stringify(again));
for(let u=0;u<2;u++){let lastPermission=-Infinity,lastSetpoint=-Infinity;for(const d of run.decisions){if(d.unitReasons[u].oldEnabled!==d.unitReasons[u].newEnabled){assert.ok(d.minute-lastPermission>=20);lastPermission=d.minute;}if(d.unitReasons[u].oldSetpointC!==d.unitReasons[u].newSetpointC){assert.ok(d.minute-lastSetpoint>=20);lastSetpoint=d.minute;}}}
assert.throws(()=>s.settings({permissionHoldMinutes:15}));assert.throws(()=>s.settings({emptyObservedSlots:1}));
console.log(JSON.stringify({passed:true,protocolHashes:true,distinctObservedVacancy:true,stableCommandWithoutTrigger:true,twentyMinuteHold:true,forecastChangesAction:{prediction:pred.command.id,persistence:hold.command.id},futureActualIsolated:true,planIndependentReplay:true,heatAndEnergyBalance:true,repeatIdentical:true,terminalObjectiveRemoved:true,noSavingsClaim:true}));
