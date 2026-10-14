'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const c=vm.createContext({});
for(const f of ['building-inputs','thermal-model','reservation-model','reservation-profile','environment-dataset','zone-lighting-model','control-scenario-model'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../data',f+'.js'),'utf8'),c);
const light=vm.runInContext('zoneLightingModel',c),model=vm.runInContext('controlScenarioModel',c),data=vm.runInContext('environmentDataset',c),artifact=vm.runInContext('reservationArtifact',c),building=vm.runInContext('buildingInputs',c);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
assert.equal(light.zones.reduce((sum,z)=>sum+z.capacity,0),314);
assert.equal(light.zones.reduce((sum,z)=>sum+z.maxTubes,0),42);
for(const wing of [0,1])assert.equal(light.zones.filter((z,i)=>i%2===wing).reduce((sum,z)=>sum+z.capacity,0),157);
for(const pattern of ['uniform','window','inner'])for(const n of [0,1,100,157,313,314]) {
 const counts=light.allocate(n,pattern);assert.equal(counts.reduce((sum,x)=>sum+x,0),n);
 assert.ok(counts.every((x,i)=>x>=0&&x<=light.zones[i].capacity));
}
assert.throws(()=>light.allocate(315));assert.throws(()=>light.allocate(1,'unknown'));
const dark={floorReservationProxy:23,southVerticalIrradianceWm2:0};
const settings=light.settings({lightingPolicy:'daylight'});
near(light.illuminance(dark,Array(14).fill(3),settings)[0].electricLux,42*2000*.6*.8/378);
// Neighbouring flux is transferred, not copied, so useful lumens are conserved.
for(let pass=0;pass<12;pass++) {
 const tubes=Array.from({length:14},(_,i)=>(i+pass)%4),values=light.illuminance(dark,tubes,settings);
 near(values.reduce((sum,v,i)=>sum+v.electricLux*light.zones[i].areaM2,0),tubes.reduce((sum,x)=>sum+x,0)*2000*.6*.8);
}
const insufficient=light.control(dark,0,true,'realtime',settings,light.state());
assert.equal(insufficient.tubesOn,42);assert.equal(insufficient.insufficientAtFull,true);
// Synthetic high-light case checks decisions, not the actual fixture photometry.
const enough=light.settings({lightingPolicy:'occupancy',distribution:'window',tubeLumens:5000,utilisationFactor:1,maintenanceFactor:1});
const memory=light.state();
assert.equal(light.control(dark,0,true,'realtime',enough,memory).tubesOn,42);
assert.equal(light.control(dark,14,true,'realtime',enough,memory).tubesOn,42);
const released=light.control(dark,15,true,'realtime',enough,memory);
assert.ok(released.tubesOn<42);assert.ok(released.zones.every(z=>z.occupied===0||z.totalLux>=300-1e-8));
const sun={floorReservationProxy:100,southVerticalIrradianceWm2:1000};
const daylight=light.settings({lightingPolicy:'daylight',distribution:'window'}),sunMemory=light.state();
assert.equal(light.control(sun,0,true,'realtime',daylight,sunMemory).tubesOn,42);
light.control(sun,5,true,'realtime',daylight,sunMemory);
const reduced=light.control(sun,15,true,'realtime',daylight,sunMemory);
assert.ok(reduced.tubesOn<42);assert.ok(reduced.zones.every(z=>z.occupied===0||z.totalLux>=300-1e-8));
// Sudden cloud/arrival restores lights, and failure to meet the target is retained.
const cloudy=light.control({...dark,floorReservationProxy:314},16,true,'realtime',daylight,sunMemory);
assert.equal(cloudy.tubesOn,42);assert.equal(cloudy.insufficientAtFull,true);
// A dark occupied inner zone must not veto an unrelated near-window off.
const mixed={floorReservationProxy:100,southVerticalIrradianceWm2:300};
const localSettings=light.settings({lightingPolicy:'daylight'}),localMemory=light.state();
light.control(mixed,0,true,'realtime',localSettings,localMemory);
let local;
for(let minute=1;minute<=25;minute++)local=light.control(mixed,minute,true,'realtime',localSettings,localMemory);
assert.equal(local.insufficientAtFull,true);assert.ok(local.tubesOn<42);
const fullMixed=light.illuminance(mixed,Array(14).fill(3),localSettings);
for(const z of local.zones)if(z.occupied>0)assert.ok(z.totalLux>=Math.min(300,fullMixed[z.id].totalLux)-1e-8);
assert.equal(local.zones[12].tubesOn,3);assert.equal(local.zones[10].tubesOn,3);
// The forecast may veto new offs, never switch empty zones on in advance.
const predMemory=light.state(),dimOutlook={people:100,southVerticalIrradianceWm2:0};
for(let minute=0;minute<=25;minute++)light.control(mixed,minute,true,'predictive',localSettings,predMemory,dimOutlook);
assert.equal(predMemory.tubes.reduce((sum,x)=>sum+x,0),42);
const closed=light.control(mixed,26,false,'predictive',localSettings,predMemory,dimOutlook);
assert.equal(closed.tubesOn,0);
const fall=light.daylightOutlook({southVerticalIrradianceWm2:200},{southVerticalIrradianceWm2:300});
assert.equal(fall.southVerticalIrradianceWm2,100);
assert.equal(light.daylightOutlook({southVerticalIrradianceWm2:300},{southVerticalIrradianceWm2:200}).southVerticalIrradianceWm2,300);
// Consecutive dimming actions in a zone are spaced, but a cloud restores now.
const timingMemory=light.state();light.control(mixed,0,true,'realtime',localSettings,timingMemory);
const timing5=light.control(mixed,5,true,'realtime',localSettings,timingMemory).zones[0].tubesOn;
assert.equal(light.control(mixed,6,true,'realtime',localSettings,timingMemory).zones[0].tubesOn,timing5);
assert.equal(light.control({...mixed,southVerticalIrradianceWm2:0},7,true,'realtime',localSettings,timingMemory).tubesOn,42);
const records=data.records.filter(r=>r.date==='2026-06-29');
const input={lightingPolicy:'daylight',distribution:'window',leadMinutes:0};
const result=model.simulateDay(records,artifact,input);
for(const m of result.modes) {
 near(m.energyKwh,m.lightingKwh+m.hvacKwh);near(m.savedKwh,m.lightingSavedKwh+m.hvacSavedKwh);
 assert.ok(m.illuminanceCompliancePct>=0&&m.illuminanceCompliancePct<=100);
 for(const t of m.trace)assert.ok(t.tubes>=0&&t.tubes<=42);
}
for(const m of result.modes.slice(1))assert.ok(m.illuminanceDeficitSeatLuxMinutes<=result.modes[0].illuminanceDeficitSeatLuxMinutes+1e-5);
assert.ok(result.modes[2].trace.some(t=>t.lightingForecast&&t.lightingForecast.people>0));
assert.ok(result.modes[1].insufficientLightingMinutes>0);
const changed=records.map((r,i)=>({...r,...(i>=24?{floorReservationProxy:314,southVerticalIrradianceWm2:1500}:{})}));
const future=model.simulateDay(changed,artifact,input);
for(let minute=0;minute<720;minute++)for(let mode=0;mode<3;mode++) {
 assert.equal(future.modes[mode].trace[minute].tubes,result.modes[mode].trace[minute].tubes);
 near(future.modes[mode].trace[minute].temperatureC,result.modes[mode].trace[minute].temperatureC);
}
assert.equal(building.equipment.taskLighting,undefined);
const html=fs.readFileSync(path.join(__dirname,'../legacy-models-20261014.html'),'utf8');
for(const id of ['controlDistribution','controlLightingPolicy','controlZoneTime','controlZoneMode','controlDaylightOutlook','controlZoneMap','controlLuxTarget','controlMethods'])assert.ok(html.includes(`id="${id}"`));
const linkedScripts=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m=>new URL(m[1],'https://example.test/').pathname);
const lightingIndex=linkedScripts.indexOf('/data/zone-lighting-model.js');
const controlIndex=linkedScripts.indexOf('/data/control-scenario-model.js');
assert.ok(lightingIndex>=0&&controlIndex>lightingIndex);
console.log('Zone lighting passed: conserved seats/flux, local non-degradation, switching delays and instant restoration, causal predictive off guards, heat/energy accounting and future isolation.');
