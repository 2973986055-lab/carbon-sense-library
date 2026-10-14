'use strict';
// Module 3-A: diagnostic response to fixed device commands, NOT predictive control.
// All thermostat, coverage and response values are uncalibrated scenarios.
const hvacResponseModel=(()=>{
  const sum=a=>a.reduce((x,y)=>x+y,0),copy=a=>a.map(x=>({...x}));
  const coverageProfiles=Object.freeze({balanced:{name:'南北各50%（旧假设）',south:.5},southBiased:{name:'南侧65%（敏感性）',south:.65},northBiased:{name:'北侧65%（敏感性）',south:.35}});
  const sensorProfiles=Object.freeze({localSouth:'对应南侧区域温度',ownSegment:'本段南北平均温度',roomMean:'全室平均温度'});
  const actions=Object.freeze([null,23,24].flatMap(w=>[null,23,24].map(e=>Object.freeze({id:`${w??'off'}_${e??'off'}`,name:`西${w===null?'关':w+'℃'} / 东${e===null?'关':e+'℃'}`,enabled:[w!==null,e!==null],setpointsC:[w??24,e??24]}))));
  function num(v,d,lo,hi,name){const n=v??d;if(typeof n!=='number'||!Number.isFinite(n)||n<lo||n>hi)throw new Error(`Invalid ${name}`);return n;}
  function settings(input={}){
    const s={coverage:input.coverage??'balanced',sensor:input.sensor??'localSouth',
      deadbandC:num(input.deadbandC,.5,.1,2,'thermostat band'),responseSeconds:num(input.responseSeconds,0,0,300,'response time'),
      compressorMinimumSeconds:num(input.compressorMinimumSeconds,180,0,600,'compressor dwell'),
      commandMinimumSeconds:num(input.commandMinimumSeconds,600,0,900,'permission dwell'),setpointMinimumSeconds:num(input.setpointMinimumSeconds,300,0,900,'setpoint dwell'),
      stepSeconds:num(input.stepSeconds,15,1,60,'time step'),mixingWPerK:num(input.mixingWPerK,300,0,5000,'mixing'),
      ownSegmentShare:num(input.ownSegmentShare,.7,.5,.95,'own-segment share'),massMultiplier:num(input.massMultiplier,10,1,30,'mass'),
      nameplateInputKw:9.18,nameplateTotalCoolingKw:28,deviceTypeVerified:false,airflowM3h:null,isMeasured:false};
    if(!coverageProfiles[s.coverage]||!sensorProfiles[s.sensor])throw new Error('Unknown coverage or sensor assumption');return s;
  }
  function commandCheck(c){if(!c||!Array.isArray(c.enabled)||c.enabled.length!==2||c.enabled.some(x=>typeof x!=='boolean')||!Array.isArray(c.setpointsC)||c.setpointsC.length!==2||c.setpointsC.some(t=>![23,24].includes(t)))throw new Error('Use two explicit on/off permissions and 23/24 C device setpoints');}
  function plant(input={}){
    const s=settings(input),p=spatialThermalModel.parameters({...input,mixingWPerK:s.mixingWPerK,ownSegmentShare:s.ownSegmentShare,massMultiplier:s.massMultiplier,timeStepSeconds:s.stepSeconds});
    const a=s.ownSegmentShare,b=coverageProfiles[s.coverage].south;
    p.coolingShares=[[a*b,(1-a)*b,a*(1-b),(1-a)*(1-b)],[(1-a)*b,a*b,(1-a)*(1-b),a*(1-b)]];
    const sensorWeights=s.sensor==='localSouth'?[[1,0,0,0],[0,1,0,0]]:s.sensor==='ownSegment'?[[.5,0,.5,0],[0,.5,0,.5]]:[[.25,.25,.25,.25],[.25,.25,.25,.25]];
    const zero={outdoorTemperatureC:0,southVerticalIrradianceWm2:0},z=[0,0,0,0],operators=new Map();
    function operator(dt){
      if(!operators.has(dt)){
        const base=spatialThermalModel.step(z,zero,z,'off',0,p,dt).temperaturesC;
        const columns=z.map((_,j)=>{const v=[0,0,0,0];v[j]=1;return spatialThermalModel.step(v,zero,z,'off',0,p,dt).temperaturesC.map((t,i)=>t-base[i]);});
        const response=['west','east'].map(m=>spatialThermalModel.step(z,zero,z,m,1,p,dt).temperaturesC.map((t,i)=>base[i]-t));
        operators.set(dt,{columns,response,forcing:new Map()});
      }return operators.get(dt);
    }
    function initial(temperaturesC=[24,24,24,24]){
      if(!Array.isArray(temperaturesC)||temperaturesC.length!==4||temperaturesC.some(x=>!Number.isFinite(x)))throw new Error('Four initial temperatures required');
      return {elapsedSeconds:0,temperaturesC:[...temperaturesC],units:[0,1].map(()=>({enabled:false,setpointC:24,on:false,fraction:0,compressorSwitches:0,lastCompressorChange:-1e12,lastPermissionChange:-1e12,lastSetpointChange:-1e12}))};
    }
    function step(state,record,counts,command,seconds=s.stepSeconds){
      commandCheck(command);const dt=num(seconds,s.stepSeconds,.001,60,'step seconds');
      const loads=spatialThermalModel.gains(record,counts,p),units=copy(state.units),before=state.temperaturesC;
      const sensed=sensorWeights.map(ws=>sum(ws.map((w,i)=>w*before[i]))),meanFractions=[],powerKw=[];
      for(let u=0;u<2;u++){
        const unit=units[u],time=state.elapsedSeconds,enabled=command.enabled[u],setpoint=command.setpointsC[u];
        if(unit.enabled!==enabled){if(time-unit.lastPermissionChange<s.commandMinimumSeconds-1e-8)throw new Error('Permission dwell violation');unit.lastPermissionChange=time;}
        if(!enabled&&unit.on&&time-unit.lastCompressorChange<s.compressorMinimumSeconds-1e-8)throw new Error('Compressor dwell prevents permission OFF');
        if(unit.setpointC!==setpoint){if(time-unit.lastSetpointChange<s.setpointMinimumSeconds-1e-8)throw new Error('Setpoint dwell violation');unit.lastSetpointChange=time;}
        let wanted=unit.on;
        if(!enabled)wanted=false;
        else if(sensed[u]>=setpoint+s.deadbandC/2)wanted=true;
        else if(sensed[u]<=setpoint-s.deadbandC/2)wanted=false;
        if(wanted!==unit.on&&time-unit.lastCompressorChange>=s.compressorMinimumSeconds-1e-8){
          unit.on=wanted;unit.lastCompressorChange=time;unit.compressorSwitches++;
        }
        // Nominal ON/OFF electrical model, not a claim this cabinet is fixed-speed.
        // Optional cooling build-up has full nominal ON power; no free cooling after OFF.
        let mean=0;
        if(unit.on){if(s.responseSeconds===0){mean=1;unit.fraction=1;}else{const decay=Math.exp(-dt/s.responseSeconds);mean=1-(1-unit.fraction)*s.responseSeconds/dt*(1-decay);unit.fraction=1-(1-unit.fraction)*decay;}}
        else unit.fraction=0;
        meanFractions.push(mean);powerKw.push(unit.on?p.ratedInputKwPerUnit:0);unit.enabled=enabled;unit.setpointC=setpoint;
      }
      const op=operator(dt),key=[record.outdoorTemperatureC,record.southVerticalIrradianceWm2,...counts].join('/');
      if(!op.forcing.has(key))op.forcing.set(key,spatialThermalModel.step(z,record,counts,'off',0,p,dt).temperaturesC);
      const free=op.forcing.get(key).map((v,i)=>v+sum(op.columns.map((col,j)=>col[i]*before[j])));
      const after=free.map((v,i)=>v-sum(op.response.map((col,u)=>col[i]*meanFractions[u])));
      const unitCoolingW=meanFractions.map(f=>f*p.ratedSensibleWPerUnit),zoneCoolingW=p.zones.map((_,i)=>sum(unitCoolingW.map((q,u)=>q*p.coolingShares[u][i])));
      const mix=[0,0,0,0];for(const {i,j,conductanceWPerK:k} of p.links){const q=k*(after[j]-after[i]);mix[i]+=q;mix[j]-=q;}
      const zoneLedger=p.zones.map((zone,i)=>{const outdoorW=zone.outdoorConductanceWPerK*(record.outdoorTemperatureC-after[i]),storedJ=zone.capacityJPerK*(after[i]-before[i]);
        return {storedJ,outdoorJ:outdoorW*dt,peopleJ:loads[i].peopleW*dt,lightsJ:loads[i].lightsW*dt,solarJ:loads[i].solarW*dt,mixingJ:mix[i]*dt,coolingJ:zoneCoolingW[i]*dt,
          residualJ:storedJ-(outdoorW+loads[i].peopleW+loads[i].lightsW+loads[i].solarW+mix[i]-zoneCoolingW[i])*dt};});
      const ledger=Object.fromEntries(Object.keys(zoneLedger[0]).map(k=>[k,sum(zoneLedger.map(l=>l[k]))]));
      return {state:{elapsedSeconds:state.elapsedSeconds+dt,temperaturesC:after,units},sensedTemperaturesC:sensed,meanFractions,unitCoolingW,zoneCoolingW,powerKw,hvacKwh:sum(powerKw)*dt/3600,ledger,
        maximumRegionResidualJ:Math.max(...zoneLedger.map(l=>Math.abs(l.residualJ)))};
    }
    return {settings:s,parameters:p,sensorWeights,initial,step};
  }
  function simulate(segments,input={},command=actions[4],initialTemperaturesC=[24,24,24,24],keepTrace=true){
    commandCheck(command);if(!Array.isArray(segments)||!segments.length)throw new Error('Missing inputs');
    const pl=plant(input);let state=pl.initial(initialTemperaturesC),hvacKwh=0,occupiedMinutes=0,withinMinutes=0,hot=0,cold=0,maxViolation=0,maxEmptyViolation=0,maxResidual=0,minTemperatureC=Math.min(...initialTemperaturesC),maxTemperatureC=Math.max(...initialTemperaturesC);
    const ledger={storedJ:0,outdoorJ:0,peopleJ:0,lightsJ:0,solarJ:0,mixingJ:0,coolingJ:0,residualJ:0},trace=[],unitOnMinutes=[0,0];
    for(const segment of segments){const duration=num(segment.seconds,1800,1,86400,'duration');let elapsed=0;
      while(elapsed<duration-1e-8){const dt=Math.min(pl.settings.stepSeconds,duration-elapsed),before=state.temperaturesC,r=pl.step(state,segment.record,segment.counts,command,dt);state=r.state;
        for(let i=0;i<4;i++){const occupied=segment.counts[i]>0,lo=occupied?23:20,hi=occupied?24:28,t=state.temperaturesC[i],violation=Math.max(0,lo-before[i],before[i]-hi,lo-t,t-hi);
          if(occupied){occupiedMinutes+=dt/60;if(violation<1e-7)withinMinutes+=dt/60;maxViolation=Math.max(maxViolation,violation);hot+=(Math.max(0,before[i]-24)+Math.max(0,t-24))/2*dt/60;cold+=(Math.max(0,23-before[i])+Math.max(0,23-t))/2*dt/60;}
          else maxEmptyViolation=Math.max(maxEmptyViolation,violation);
        }
        minTemperatureC=Math.min(minTemperatureC,...state.temperaturesC);maxTemperatureC=Math.max(maxTemperatureC,...state.temperaturesC);
        for(let u=0;u<2;u++)if(state.units[u].on)unitOnMinutes[u]+=dt/60;
        hvacKwh+=r.hvacKwh;for(const k of Object.keys(ledger))ledger[k]+=r.ledger[k];maxResidual=Math.max(maxResidual,r.maximumRegionResidualJ,Math.abs(r.ledger.residualJ));
        if(keepTrace)trace.push({minute:state.elapsedSeconds/60,beforeC:[...before],temperaturesC:[...state.temperaturesC],sensedC:r.sensedTemperaturesC,counts:[...segment.counts],on:state.units.map(u=>u.on),coolingKw:r.unitCoolingW.map(x=>x/1000),powerKw:r.powerKw,zoneCoolingW:r.zoneCoolingW});elapsed+=dt;
      }
    }
    return {module:'3-A',command,settings:pl.settings,coverage:pl.parameters.coolingShares,sensorWeights:pl.sensorWeights,initialTemperaturesC:[...initialTemperaturesC],finalTemperaturesC:state.temperaturesC,hvacKwh,
      nominalEnergyModel:'额定输入×模拟制冷开启时间；部分负荷/COP变化、制冷停止期间风机及待机耗电未核实',unitOnMinutes,simulatedCompressorTransitions:state.units.map(u=>u.compressorSwitches),endOn:state.units.map(u=>u.on),
      sampledCompliancePct:occupiedMinutes?100*withinMinutes/occupiedMinutes:null,maximumOccupiedViolationC:maxViolation,maximumEmptyViolationC:maxEmptyViolation,hotDegreeMinutes:hot,coldDegreeMinutes:cold,
      fixedCommandPass:maxViolation<1e-6&&maxEmptyViolation<1e-6,minTemperatureC,maxTemperatureC,outsideDiagnosticRange:minTemperatureC<16||maxTemperatureC>40,ledger,maxBalanceResidualJ:maxResidual,trace,isMeasured:false,isPredictiveControl:false,
      note:'固定指令响应筛查；失败不证明所有动态控制均不可行。未比较三策略或计算节电率；结束时设备状态保留，不强制恢复或关机。'};
  }
  function daySegments(records,pattern='west'){
    if(!Array.isArray(records)||records.length!==48||records.some((r,i)=>r.slot!==i||r.date!==records[0].date))throw new Error('Complete chronological day required');
    return records.slice(13,45).map(r=>({record:r,counts:spatialOccupancyModel.allocate(r.floorReservationProxy,pattern),seconds:1800}));
  }
  return {coverageProfiles,sensorProfiles,actions,settings,plant,simulate,daySegments};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=hvacResponseModel;
