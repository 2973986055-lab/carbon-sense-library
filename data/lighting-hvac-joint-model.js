'use strict';

// Candidate joint replay. The 14 lamp groups, their positions and lux are
// explicit scenarios; the four-region HVAC and frozen forecast are unchanged.
const lightingHvacJointModel=(()=>{
  const sum=a=>a.reduce((n,x)=>n+x,0);
  const capacity=[23,23,24,23,23,22,22,23,23,24,21,21,21,21];
  const region=[0,0,0,1,1,1,1,2,2,2,3,3,3,3];
  const daylightFactor=region.map(r=>r<2?.025:.004);
  const lampW=18,lampsPerGroup=3,groupAreaM2=378/14;
  const assumptions=Object.freeze({
    mapping:'假设14组灯为南北两排、每排沿西向东7组；每组3根。不是现场灯位图。',
    capacity:'各组21—24座，合计314座；四区汇总70/90/70/84，与既有四区假设一致。',
    light:'18 W/根；2000 lm/根、利用系数0.6、维护系数0.8、目标300 lx及采光系数均为未校准情景。',
    heat:'假定所有灯电功率成为所在四区显热；空调预测期间将当前灯状态保持30分钟，不读取未来真实灯状态。',
    service:'全开模型照度仍低于300 lx时，该有人组不得失去任何全开贡献；平均模型照度不是桌面实测。'
  });
  function checkCounts(counts){
    if(!Array.isArray(counts)||counts.length!==4||counts.some((n,i)=>!Number.isInteger(n)||n<0||n>spatialOccupancyModel.zones[i].capacity))throw new Error('Invalid four-region occupancy');
  }
  function groups(counts){
    checkCounts(counts);const out=Array(14).fill(0);
    for(let r=0;r<4;r++)for(let remaining=counts[r];remaining>0;){
      let progressed=false;
      for(let i=0;i<14&&remaining>0;i++)if(region[i]===r&&out[i]<capacity[i]){out[i]++;remaining--;progressed=true;}
      if(!progressed)throw new Error('Lighting-group capacity mismatch');
    }
    return out;
  }
  function watts(tubes){
    if(!Array.isArray(tubes)||tubes.length!==14||tubes.some(n=>!Number.isInteger(n)||n<0||n>3))throw new Error('Expected 14 groups of 0–3 tubes');
    const out=[0,0,0,0];tubes.forEach((n,i)=>out[region[i]]+=n*lampW);return out;
  }
  function lux(tubes,irradiance,options={}){
    if(!Number.isFinite(irradiance)||irradiance<0)throw new Error('Invalid solar irradiance');
    watts(tubes);const lumens=options.tubeLumens??2000,utilisation=options.utilisationFactor??.6,maintenance=options.maintenanceFactor??.8;
    const daylightScale=options.daylightScale??1,curtain=options.curtainClosedFraction??0;
    if(!Number.isFinite(lumens)||lumens<=0||utilisation<0||utilisation>1||maintenance<0||maintenance>1||daylightScale<0||daylightScale>2||curtain<0||curtain>1)throw new Error('Invalid optical scenario');
    return tubes.map((n,i)=>{
      const neighbours=[i-1,i+1].filter(j=>j>=0&&j<14&&region[j]===region[i]);
      const electric=(n*(1-neighbours.length*.1)+sum(neighbours.map(j=>tubes[j]*.1)))*lumens*utilisation*maintenance/groupAreaM2;
      const daylight=irradiance*110*daylightFactor[i]*daylightScale*(1-.9*curtain);
      return electric+daylight;
    });
  }
  function memory(){return {tubes:Array(14).fill(0),emptySince:Array(14).fill(null),brightSince:Array(14).fill(null),lastChange:Array(14).fill(-Infinity),opened:false};}
  function lightingStep(mem,mode,minute,record,counts,futureCounts,previousRecord,options={}){
    const occupied=groups(counts),future=groups(futureCounts??counts),before=[...mem.tubes],all=Array(14).fill(3),target=options.targetLux??300;
    if(!Number.isFinite(target)||target<300||target>750)throw new Error('Invalid target lux');
    if(!mem.opened){mem.tubes=all.slice();mem.lastChange.fill(minute);mem.opened=true;}
    const full=lux(all,record.southVerticalIrradianceWm2,options),floor=full.map(x=>Math.min(x,target));
    const safe=tubes=>{
      const v=lux(tubes,record.southVerticalIrradianceWm2,options);
      return occupied.every((n,i)=>n===0||v[i]>=floor[i]-1e-8);
    };
    if(mode==='baseline'){mem.tubes=all.slice();}
    else {
      // Return light immediately where occupied service fell below the
      // full-on-or-target floor. Offs alone obey the five-minute hold.
      for(let pass=0;pass<42&&!safe(mem.tubes);pass++){
        const current=lux(mem.tubes,record.southVerticalIrradianceWm2,options);
        let best=-1,gain=0;
        for(let i=0;i<14;i++)if(mem.tubes[i]<3){
          const trial=mem.tubes.slice();trial[i]++;
          const next=lux(trial,record.southVerticalIrradianceWm2,options);
          const score=sum(next.map((v,j)=>occupied[j]>0?Math.min(Math.max(0,floor[j]-current[j]),Math.max(0,v-current[j])):0));
          if(score>gain+1e-8){gain=score;best=i;}
        }
        if(best<0)break;mem.tubes[best]++;mem.lastChange[best]=minute;
      }
      if(!safe(mem.tubes)){mem.tubes=all.slice();mem.lastChange.fill(minute);}
      for(let i=0;i<14;i++){
        if(occupied[i]>0)mem.emptySince[i]=null;
        else if(mem.emptySince[i]===null)mem.emptySince[i]=minute;
      }
      const nowLux=lux(mem.tubes,record.southVerticalIrradianceWm2,options);
      for(let i=0;i<14;i++){
        if(occupied[i]>0&&nowLux[i]>=target+50){if(mem.brightSince[i]===null)mem.brightSince[i]=minute;}
        else mem.brightSince[i]=null;
      }
      const slope=previousRecord?(record.southVerticalIrradianceWm2-previousRecord.southVerticalIrradianceWm2):0;
      const futureIrradiance=Math.max(0,record.southVerticalIrradianceWm2+Math.min(0,slope));
      const futureFull=lux(all,futureIrradiance,options),futureFloor=futureFull.map(x=>Math.min(x,target));
      for(let pass=0;pass<3;pass++)for(let i=13;i>=0;i--){
        const vacant=occupied[i]===0&&minute-mem.emptySince[i]>=15;
        const daylight=occupied[i]>0&&mem.brightSince[i]!==null&&minute-mem.brightSince[i]>=5;
        if(!vacant&&!daylight||mem.tubes[i]===0||minute-mem.lastChange[i]<5)continue;
        const trial=mem.tubes.slice();trial[i]--;
        if(!safe(trial))continue;
        if(mode==='predictive'){
          const projected=lux(trial,futureIrradiance,options);
          if(future.some((n,j)=>n>0&&projected[j]<futureFloor[j]-1e-8))continue;
        }
        mem.tubes=trial;mem.lastChange[i]=minute;
      }
    }
    const actualLux=lux(mem.tubes,record.southVerticalIrradianceWm2,options);
    return {tubesOn:sum(mem.tubes),tubes:[...mem.tubes],zoneWatts:watts(mem.tubes),occupiedGroups:occupied,
      belowTargetPeople:sum(occupied.map((n,i)=>actualLux[i]<target-1e-8?n:0)),
      belowFullOnTargetPeople:sum(occupied.map((n,i)=>full[i]<target-1e-8?n:0)),
      servicePass:occupied.every((n,i)=>n===0||actualLux[i]>=floor[i]-1e-8),
      minimumOccupiedLux:Math.min(...actualLux.filter((_,i)=>occupied[i]>0)),
      switches:sum(mem.tubes.map((n,i)=>Math.abs(n-before[i]))),forecastUsesFutureActual:false};
  }
  function solve(matrix,rhs){
    const a=matrix.map((row,i)=>[...row,rhs[i]]),n=rhs.length;
    for(let k=0;k<n;k++){
      let pivot=k;for(let i=k+1;i<n;i++)if(Math.abs(a[i][k])>Math.abs(a[pivot][k]))pivot=i;
      [a[k],a[pivot]]=[a[pivot],a[k]];const d=a[k][k];if(Math.abs(d)<1e-12)throw new Error('Singular heat matrix');
      for(let j=k;j<=n;j++)a[k][j]/=d;
      for(let i=0;i<n;i++)if(i!==k){const q=a[i][k];for(let j=k;j<=n;j++)a[i][j]-=q*a[k][j];}
    }return a.map(row=>row[n]);
  }
  function coupledPlant(input={}){
    const pl=hvacResponseModel.plant(input),p=pl.parameters,stepWithoutLights=pl.step;
    p.lightingTotalW=0;let light=[0,0,0,0];
    function setLighting(zoneWatts){if(!Array.isArray(zoneWatts)||zoneWatts.length!==4||zoneWatts.some(v=>!Number.isFinite(v)||v<0||v>756)||sum(zoneWatts)>756+1e-8)throw new Error('Invalid lighting load');light=[...zoneWatts];}
    function step(state,record,counts,command,dt){
      const base=stepWithoutLights(state,record,counts,command,dt),t=base.state.temperaturesC;
      const matrix=p.zones.map((z,i)=>p.zones.map((_,j)=>i===j?z.capacityJPerK/dt+z.outdoorConductanceWPerK:0));
      for(const {i,j,conductanceWPerK:k} of p.links){matrix[i][i]+=k;matrix[j][j]+=k;matrix[i][j]-=k;matrix[j][i]-=k;}
      const delta=solve(matrix,light),after=t.map((v,i)=>v+delta[i]);
      const loads=spatialThermalModel.gains(record,counts,p),mix=[0,0,0,0];
      for(const {i,j,conductanceWPerK:k} of p.links){const q=k*(after[j]-after[i]);mix[i]+=q;mix[j]-=q;}
      const regionLedger=p.zones.map((z,i)=>{
        const storedJ=z.capacityJPerK*(after[i]-state.temperaturesC[i]);
        const outdoorJ=z.outdoorConductanceWPerK*(record.outdoorTemperatureC-after[i])*dt;
        const peopleJ=loads[i].peopleW*dt,lightsJ=light[i]*dt,solarJ=loads[i].solarW*dt,mixingJ=mix[i]*dt,coolingJ=base.zoneCoolingW[i]*dt;
        return {storedJ,outdoorJ,peopleJ,lightsJ,solarJ,mixingJ,coolingJ,
          residualJ:storedJ-outdoorJ-peopleJ-lightsJ-solarJ-mixingJ+coolingJ};
      });
      const ledger=Object.fromEntries(Object.keys(regionLedger[0]).map(k=>[k,sum(regionLedger.map(v=>v[k]))]));
      return {...base,state:{...base.state,temperaturesC:after},ledger,
        maximumRegionResidualJ:Math.max(...regionLedger.map(v=>Math.abs(v.residualJ)))};
    }
    return {...pl,setLighting,step};
  }
  function runDay(records,artifact,mode,input={}){
    if(!['baseline','realtime','predictive'].includes(mode))throw new Error('Unknown joint mode');
    if(!Array.isArray(records)||records.length!==48||records.some((r,i)=>r.slot!==i||r.date!==records[0].date))throw new Error('Complete chronological day required');
    const s=hvacForecastGuardV3Model.settings(input),plant=coupledPlant(s),mem=memory();
    let state=plant.initial(Array(4).fill(s.initialTemperatureC)),supervision=hvacSupervisoryModel.memory(),metrics=hvacComfortV2Model.metrics();
    let lightingKwh=0,occupiedSeatMinutes=0,belowTargetSeatMinutes=0,fullOnDeficitSeatMinutes=0,switches=0,maxResidualJ=0,lightingServicePass=true;
    const trace=[],decisions=[],ledger={storedJ:0,outdoorJ:0,peopleJ:0,lightsJ:0,solarJ:0,mixingJ:0,coolingJ:0,residualJ:0};
    for(let minute=s.startMinute;minute<s.endMinute;minute+=5){
      const record=records[Math.floor(minute/30)],previous=record.slot>0?records[record.slot-1]:null;
      const counts=spatialOccupancyModel.allocate(record.floorReservationProxy,s.pattern);
      supervision=hvacSupervisoryModel.observeSlot(supervision,record.slot,counts);
      const forecast=hvacPredictiveModel.projection(record,artifact,minute,counts,s);
      const light=lightingStep(mem,mode,minute,record,counts,mode==='predictive'?forecast.predictedCounts:counts,previous,input);
      plant.setLighting(light.zoneWatts);lightingKwh+=light.tubesOn*lampW*5/60000;
      occupiedSeatMinutes+=sum(counts)*5;belowTargetSeatMinutes+=light.belowTargetPeople*5;
      fullOnDeficitSeatMinutes+=light.belowFullOnTargetPeople*5;switches+=light.switches;lightingServicePass&&=light.servicePass;
      let command,guard=null;
      if(mode==='baseline'){
        const id=sum(counts)>0?'24_24':'off_off',old=state.units.map(u=>u.enabled?u.setpointC:'off').join('_');
        const allowed=hvacPredictiveModel.allowed(state,minute,s),action=allowed.find(a=>a.id===id)||allowed.find(a=>a.id===old);
        command=hvacPredictiveModel.commandFor(action,state);
      }else if(mode==='realtime')command=hvacComfortV2Model.decision(state,record,counts,minute,artifact,plant,supervision,{...s,forecastMode:'persistence'}).command;
      else{const d=hvacForecastGuardV3Model.decision(state,record,counts,minute,artifact,plant,supervision,s);command=d.command;guard=d.forecastGuard;}
      const beginning=[...state.temperaturesC];let blockHvacKwh=0;
      for(let elapsed=0;elapsed<300-1e-8;){
        const dt=Math.min(plant.settings.stepSeconds,300-elapsed),next=plant.step(state,record,counts,command,dt);
        hvacComfortV2Model.observe(metrics,state.temperaturesC,next.state.temperaturesC,counts,dt,s);
        metrics.energyKwh+=next.hvacKwh;blockHvacKwh+=next.hvacKwh;
        for(const key of Object.keys(ledger))ledger[key]+=next.ledger[key];
        maxResidualJ=Math.max(maxResidualJ,next.maximumRegionResidualJ,Math.abs(next.ledger.residualJ));state=next.state;elapsed+=dt;
      }
      if(input.keepTrace!==false)trace.push({minute,slot:record.slot,people:sum(counts),counts:[...counts],tubes:[...light.tubes],tubesOn:light.tubesOn,
        zoneLightWatts:light.zoneWatts,belowTargetPeople:light.belowTargetPeople,command:command.id,beginningC:beginning,
        endingC:[...state.temperaturesC],hvacKwh:blockHvacKwh,lightingKwh:light.tubesOn*lampW*5/60000,guard});
      decisions.push({minute,command:command.id,lightTubes:light.tubesOn,guardReason:guard?.reason??null});
    }
    const finalTemperaturesC=[...state.temperaturesC],storedChangeKwhThermal=sum(plant.parameters.zones.map((z,i)=>z.capacityJPerK*(finalTemperaturesC[i]-s.initialTemperatureC)))/3600000;
    const expectedLightJ=lightingKwh*3600000;
    if(Math.abs(expectedLightJ-ledger.lightsJ)>1e-4)throw new Error('Lighting electricity and heat ledger disagree');
    return {version:1,mode,date:records[0].date,settings:s,assumptions,hvacKwh:metrics.energyKwh,lightingKwh,totalKwh:metrics.energyKwh+lightingKwh,
      metrics,occupiedCompliancePct:metrics.occupiedZoneMinutes?100*metrics.withinZoneMinutes/metrics.occupiedZoneMinutes:null,
      temperaturePass:hvacComfortV2Model.isFeasible(metrics),lightingServicePass,
      modelTargetCompliancePct:occupiedSeatMinutes?100*(occupiedSeatMinutes-belowTargetSeatMinutes)/occupiedSeatMinutes:null,
      fullOnModelTargetCompliancePct:occupiedSeatMinutes?100*(occupiedSeatMinutes-fullOnDeficitSeatMinutes)/occupiedSeatMinutes:null,
      switches,finalTemperaturesC,storedChangeKwhThermal,finalDeviceState:state.units.map(u=>({enabled:u.enabled,on:u.on,setpointC:u.setpointC})),
      ledger,maxResidualJ,decisions,trace,usesFutureActual:false,isMeasured:false,qualifiedJointSavingPct:null};
  }
  function compare(reference,candidate){
    if(reference.date!==candidate.date||reference.settings.mixingWPerK!==candidate.settings.mixingWPerK||reference.settings.stepSeconds!==candidate.settings.stepSeconds)throw new Error('Mismatched joint replay');
    const terminalDifferenceC=Math.max(...reference.finalTemperaturesC.map((t,i)=>Math.abs(t-candidate.finalTemperaturesC[i])));
    const serviceComparable=reference.temperaturePass&&candidate.temperaturePass&&reference.lightingServicePass&&candidate.lightingServicePass&&terminalDifferenceC<=.05;
    // Lux, thermal plant, regional presence and lamp layout are uncalibrated;
    // even a comparable simulation is not a verified site saving.
    return {referenceMode:reference.mode,candidateMode:candidate.mode,date:reference.date,
      rawTotalDifferenceKwh:reference.totalKwh-candidate.totalKwh,
      rawTotalDifferencePct:100*(reference.totalKwh-candidate.totalKwh)/reference.totalKwh,
      rawHvacDifferenceKwh:reference.hvacKwh-candidate.hvacKwh,rawLightingDifferenceKwh:reference.lightingKwh-candidate.lightingKwh,
      terminalDifferenceC,serviceComparable,qualifiedJointSavingPct:null,
      reason:!serviceComparable?'温度、灯服务或末温不可比':reference.fullOnModelTargetCompliancePct<100-1e-8?'全开模型照度未全面达标，且未做现场照度校准':'仅为未经现场校准的条件模拟，不是实测节电率'};
  }
  return {capacity,region,daylightFactor,assumptions,groups,watts,lux,memory,lightingStep,coupledPlant,runDay,compare};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=lightingHvacJointModel;
