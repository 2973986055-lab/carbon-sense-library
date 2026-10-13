'use strict';

// A hypothesis for 14 lighting groups, not a measured seat/fixture map.
// Illuminance is an average screening estimate; no real switches are operated.
const zoneLightingModel=(()=>{
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const numeric=(n,d)=>n==null||n===''||typeof n==='boolean'||!Number.isFinite(Number(n))?d:Number(n);
  const daylightFactors=[.04,.025,.015,.01,.006,.004,.002];
  const zones=Array.from({length:14},(_,i)=>({id:i,name:`${i%2===0?'左':'右'}侧${Math.floor(i/2)+1}区`,
    capacity:Math.floor(i/2)<3?23:22,maxTubes:3,areaM2:378/14,
    depth:Math.floor(i/2),daylightFactor:daylightFactors[Math.floor(i/2)]}));
  function settings(input={}) {
    return {lightingPolicy:['fixed','occupancy','daylight'].includes(input.lightingPolicy)?input.lightingPolicy:'fixed',
      distribution:['uniform','window','inner'].includes(input.distribution)?input.distribution:'uniform',
      tubeLumens:clamp(numeric(input.tubeLumens,2000),500,5000),
      utilisationFactor:clamp(numeric(input.utilisationFactor,.6),.1,1),
      maintenanceFactor:clamp(numeric(input.maintenanceFactor,.8),.1,1),
      targetLux:clamp(numeric(input.targetLux,300),300,750),
      vacancyDelayMinutes:clamp(Math.round(numeric(input.vacancyDelayMinutes,15)),0,60),
      daylightScale:clamp(numeric(input.daylightScale,1),0,2),
      daylightOffMarginLux:50,daylightHoldMinutes:5,minimumSwitchIntervalMinutes:5,exteriorLuminousEfficacy:110,
      neighbouringFluxFraction:.1,curtainVisibleTransmittanceClosed:.1};
  }
  const orderings={uniform:[],window:[],inner:[]};
  for(let row=0;row<23;row++)zones.forEach((z,i)=>{if(row<z.capacity)orderings.uniform.push(i);});
  for(const pattern of ['window','inner'])for(const depth of pattern==='window'?[0,1,2,3,4,5,6]:[6,5,4,3,2,1,0])
    for(let row=0;row<zones[depth*2].capacity;row++)orderings[pattern].push(depth*2,depth*2+1);
  function allocate(people,pattern='uniform') {
    if(!Number.isInteger(people)||people<0||people>314)throw new Error('Expected 0–314 scenario occupants');
    if(!orderings[pattern])throw new Error('Unknown distribution');
    const counts=Array(14).fill(0);for(const zone of orderings[pattern].slice(0,people))counts[zone]++;
    return counts;
  }
  function illuminance(record,tubes,s) {
    if(!Array.isArray(tubes)||tubes.length!==14||tubes.some(n=>!Number.isInteger(n)||n<0||n>3))throw new Error('Expected fourteen groups of 0–3 tubes');
    const radiation=record.southVerticalIrradianceWm2;
    if(!Number.isFinite(radiation)||radiation<0)throw new Error('Invalid daylight input');
    const flux=Array(14).fill(0);
    tubes.forEach((count,i)=>{
      const neighbours=[i^1,i-2,i+2].filter(j=>j>=0&&j<14);
      const usable=count*s.tubeLumens*s.utilisationFactor*s.maintenanceFactor;
      flux[i]+=usable*(1-neighbours.length*s.neighbouringFluxFraction);
      for(const j of neighbours)flux[j]+=usable*s.neighbouringFluxFraction;
    });
    const curtainFactor=1-clamp(numeric(s.curtainClosedFraction,0),0,1)*(1-s.curtainVisibleTransmittanceClosed);
    return zones.map((z,i)=>({electricLux:flux[i]/z.areaM2,
      daylightLux:radiation*s.exteriorLuminousEfficacy*z.daylightFactor*s.daylightScale*curtainFactor,
      totalLux:flux[i]/z.areaM2+radiation*s.exteriorLuminousEfficacy*z.daylightFactor*s.daylightScale*curtainFactor}));
  }
  function daylightOutlook(record,previousRecord=null) {
    // A causal declining-trend guard, not a trained or calibrated lux forecast.
    // Positive trends are ignored so expected sunshine does not justify an off.
    const current=record.southVerticalIrradianceWm2;
    const slope=previousRecord ? (current-previousRecord.southVerticalIrradianceWm2)/30 : 0;
    return {horizonMinutes:30,southVerticalIrradianceWm2:Math.max(0,current+Math.min(0,slope)*30),
      method:'当前值与最近半小时下降趋势的保守外推，非已验证采光预测'};
  }
  function state(){return {tubes:Array(14).fill(0),emptySince:Array(14).fill(null),brightSince:Array(14).fill(null),
    lastChangeMinute:Array(14).fill(-Infinity),wasOpen:false};}
  function control(record,minute,sessionOpen,modeId,s,memory,outlook=null) {
    const occupants=allocate(record.floorReservationProxy,s.distribution),all=Array(14).fill(3);
    const before=memory.tubes.slice(),previouslyOpen=memory.wasOpen;
    if(!sessionOpen) {memory.tubes.fill(0);memory.emptySince.fill(null);memory.brightSince.fill(null);memory.wasOpen=false;}
    else if(!memory.wasOpen) {memory.tubes=all.slice();memory.lastChangeMinute.fill(minute);memory.wasOpen=true;}
    const fullLux=illuminance(record,sessionOpen?all:Array(14).fill(0),s);
    // If the full installation cannot reach the target, retain its entire
    // contribution to that occupied zone. An unrelated zone may still dim.
    const floors=fullLux.map(v=>Math.min(s.targetLux,v.totalLux));
    const satisfies=values=>occupants.every((n,i)=>n===0||values[i].totalLux>=floors[i]-1e-8);
    const insufficientAtFull=sessionOpen&&occupants.some((n,i)=>n>0&&fullLux[i].totalLux<s.targetLux-1e-8);
    const opticalKey=[s.tubeLumens,s.utilisationFactor,s.maintenanceFactor,s.neighbouringFluxFraction].join('/');
    if(memory.opticalKey!==opticalKey) {
      memory.opticalKey=opticalKey;
      memory.tubeEffects=zones.map((_,i)=>{
        const neighbours=[i^1,i-2,i+2].filter(j=>j>=0&&j<14);
        const useful=s.tubeLumens*s.utilisationFactor*s.maintenanceFactor;
        return zones.map((z,j)=>useful/z.areaM2*(j===i?1-neighbours.length*s.neighbouringFluxFraction:neighbours.includes(j)?s.neighbouringFluxFraction:0));
      });
    }
    const adjust=(values,i,delta)=>values.map((v,j)=>({...v,
      electricLux:v.electricLux+delta*memory.tubeEffects[i][j],totalLux:v.totalLux+delta*memory.tubeEffects[i][j]}));
    let forecastGuardActive=false;
    if(sessionOpen) {
      for(let i=0;i<14;i++) {
        if(occupants[i]>0)memory.emptySince[i]=null;
        else if(memory.emptySince[i]==null)memory.emptySince[i]=minute;
      }
      if(modeId==='fixed'||s.lightingPolicy==='fixed')memory.tubes=all.slice();
      else {
        let current=illuminance(record,memory.tubes,s);
        // Restore only lamps that help a current occupied-zone deficit.
        // Restoration is immediate; the switching delay applies only to offs.
        for(let pass=0;pass<42&&!satisfies(current);pass++) {
          let best=-1,bestGain=0;
          for(let i=0;i<14;i++)if(memory.tubes[i]<3) {
            const gain=occupants.reduce((sum,n,j)=>sum+(n>0?Math.min(Math.max(0,floors[j]-current[j].totalLux),memory.tubeEffects[i][j]):0),0);
            if(gain>bestGain+1e-8) {best=i;bestGain=gain;}
          }
          if(best<0)break;
          memory.tubes[best]++;memory.lastChangeMinute[best]=minute;memory.brightSince[best]=null;
          current=adjust(current,best,1);
        }
        if(!satisfies(current)) {memory.tubes=all.slice();memory.lastChangeMinute.fill(minute);current=fullLux;}
        const predicted=modeId==='predictive'&&outlook ? allocate(outlook.people,s.distribution) : null;
        const forecastRecord=predicted ? {...record,southVerticalIrradianceWm2:outlook.southVerticalIrradianceWm2} : null;
        const forecastFull=predicted ? illuminance(forecastRecord,all,s) : null;
        const forecastNow=predicted ? illuminance(forecastRecord,memory.tubes,s) : null;
        // A forecast only vetoes new offs. It does not switch on empty zones
        // ahead of time, or turn an existing forecast deficit into a global veto.
        const forecastFloors=predicted ? forecastNow.map((v,i)=>Math.min(s.targetLux,forecastFull[i].totalLux,v.totalLux)) : null;
        const futureSafe=values=>!predicted||values
          .every((v,i)=>predicted[i]===0||v.totalLux+forecastNow[i].daylightLux-current[i].daylightLux>=forecastFloors[i]-1e-8);
        const eligible=occupants.map((n,i)=>{
          if(n===0) {memory.brightSince[i]=null;return minute-memory.emptySince[i]>=s.vacancyDelayMinutes;}
          if(current[i].totalLux>=s.targetLux+s.daylightOffMarginLux) {
            if(memory.brightSince[i]==null)memory.brightSince[i]=minute;
          } else memory.brightSince[i]=null;
          return s.lightingPolicy==='daylight'&&memory.brightSince[i]!=null&&minute-memory.brightSince[i]>=s.daylightHoldMinutes;
        });
        const priority=zones.map((_,i)=>i).sort((a,b)=>(occupants[a]>0)-(occupants[b]>0)||b-a);
        for(let pass=0;pass<3;pass++)for(const i of priority) {
          if(!eligible[i]||memory.tubes[i]===0||minute-memory.lastChangeMinute[i]<s.minimumSwitchIntervalMinutes
            ||occupants[i]>0&&current[i].totalLux<s.targetLux+s.daylightOffMarginLux)continue;
          const candidate=memory.tubes.slice();candidate[i]--;
          const values=adjust(current,i,-1);
          if(satisfies(values)) {
            if(!futureSafe(values)) {forecastGuardActive=true;continue;}
            memory.tubes=candidate;current=values;memory.lastChangeMinute[i]=minute;
          }
        }
      }
    }
    const values=illuminance(record,memory.tubes,s);
    const withinLuxPeople=occupants.reduce((sum,n,i)=>sum+(values[i].totalLux>=s.targetLux-1e-8?n:0),0);
    const switchOperations=memory.tubes.reduce((sum,n,i)=>sum+Math.abs(n-before[i]),0);
    const deficitSeatLux=occupants.reduce((sum,n,i)=>sum+n*Math.max(0,s.targetLux-values[i].totalLux),0);
    return {tubesOn:memory.tubes.reduce((sum,n)=>sum+n,0),withinLuxPeople,insufficientAtFull,deficitSeatLux,
      switchOperations,withinSessionSwitchOperations:previouslyOpen&&sessionOpen?switchOperations:0,forecastGuardActive,
      zones:zones.map((z,i)=>({...z,occupied:occupants[i],tubesOn:memory.tubes[i],...values[i]}))};
  }
  const sources=[
    {url:'https://www.signify.com/global/prof/led-lamps-and-tubes/led-tubes/philips-corepro-led-tube-em-mains-t8/LP_CF_CORPLT_EU/family',use:'18W参考产品2000lm，不是本场所已核验光通量'},
    {url:'https://bzh.scjgj.beijing.gov.cn/bzh/apifile/file/2023/20231220/845693bc-3ee5-48e1-ae69-7bb703dc4e57.pdf',use:'附录C的平均照度光通量法，不验证本场所照明合规'},
    {url:'https://www.energy.gov/cmei/femp/office-energy-checklist',use:'占用与自然光照明控制的应用参考'}
  ];
  return {zones,settings,allocate,illuminance,daylightOutlook,state,control,sources};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=zoneLightingModel;
