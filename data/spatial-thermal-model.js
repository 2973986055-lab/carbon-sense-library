'use strict';

// Module 2: uncalibrated four-region sensible heat balance, not an AC controller.
// West/east unit positions are user-confirmed; cooling shares remain assumptions.
const spatialThermalModel = (() => {
  const sum=xs=>xs.reduce((a,b)=>a+b,0),J_PER_KWH=3600000;
  const modes=Object.freeze([
    Object.freeze({id:'off',name:'两台暂停',enabled:Object.freeze([false,false])}),
    Object.freeze({id:'west',name:'仅西侧机',enabled:Object.freeze([true,false])}),
    Object.freeze({id:'east',name:'仅东侧机',enabled:Object.freeze([false,true])}),
    Object.freeze({id:'both',name:'两台开启',enabled:Object.freeze([true,true])})
  ]);
  function number(value,fallback,min,max,name){
    const v=value===undefined?fallback:value;
    if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new Error(`Invalid ${name}`);
    return v;
  }
  function vector(value,name,min=-80,max=100){
    if(!Array.isArray(value)||value.length!==4||value.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<min||v>max))throw new Error(`Invalid ${name}`);
    return [...value];
  }
  function parameters(input={}){
    const a=buildingInputs.assumptions,g=buildingInputs.geometry,h=buildingInputs.equipment.hvac;
    const settings={
      heightM:number(input.heightM,a.ceilingHeightM,3.3,5,'height'),
      massMultiplier:number(input.massMultiplier,10,1,30,'thermal mass'),
      southAreaFraction:number(input.southAreaFraction,.5,.2,.8,'south area fraction'),
      westAreaFraction:number(input.westAreaFraction,.5,.2,.8,'west area fraction'),
      windowWestFraction:number(input.windowWestFraction,.5,.1,.9,'window west fraction'),
      mixingWPerK:number(input.mixingWPerK,300,0,5000,'interregion exchange'),
      ownSegmentShare:number(input.ownSegmentShare,.7,.5,.95,'own-segment cooling share'),
      ach:number(input.ach,a.infiltrationAch,0,3,'outdoor air exchange'),
      glassU:number(input.glassU,a.glassUValueWm2K,0,8,'glass conductance'),
      opaqueU:number(input.opaqueU,a.opaqueUValueWm2K,0,4,'wall conductance'),
      shgc:number(input.shgc,a.solarHeatGainCoefficient,0,1,'solar gain'),
      curtainClosedFraction:number(input.curtainClosedFraction,0,0,1,'curtain'),
      peopleSensibleW:number(input.peopleSensibleW,a.peopleTotalHeatW*a.peopleSensibleFraction,0,180,'people heat'),
      shr:number(input.shr,a.coilSensibleHeatRatio,.5,.95,'sensible fraction'),
      cyclingCoefficient:number(input.cyclingCoefficient,a.genericCyclingLossCoefficient,0,.3,'generic cycling coefficient'),
      timeStepSeconds:number(input.timeStepSeconds,60,.5,300,'time step')
    };
    const s=settings.southAreaFraction,w=settings.westAreaFraction,f=378;
    const areas=[f*s*w,f*s*(1-w),f*(1-s)*w,f*(1-s)*(1-w)];
    const windows=[g.windowAreaM2*settings.windowWestFraction,g.windowAreaM2*(1-settings.windowWestFraction),0,0];
    const opaque=[27*settings.heightM*w-windows[0],27*settings.heightM*(1-w)-windows[1],0,0];
    if(opaque.some(v=>v<0))throw new Error('Window area exceeds assumed south facade segment');
    const density=1.2,cp=1006;
    const zones=spatialOccupancyModel.zones.map((z,i)=>({id:z.id,name:z.name,capacity:z.capacity,
      assumedAreaM2:areas[i],areaMeasured:false,windowAreaM2:windows[i],
      capacityJPerK:density*cp*areas[i]*settings.heightM*settings.massMultiplier,
      outdoorConductanceWPerK:density*cp*areas[i]*settings.heightM*settings.ach/3600+windows[i]*settings.glassU+opaque[i]*settings.opaqueU}));
    // Symmetric equivalent mixing links on the four adjacent region boundaries.
    // W/K = equivalent air mass exchange * cp; there are no assumed partitions.
    const links=[[0,1],[0,2],[1,3],[2,3]].map(([i,j])=>({i,j,conductanceWPerK:settings.mixingWPerK}));
    const share=settings.ownSegmentShare;
    const coolingShares=[[share/2,(1-share)/2,share/2,(1-share)/2],[(1-share)/2,share/2,(1-share)/2,share/2]];
    return {version:1,settings,zones,links,coolingShares,
      totalAreaM2:sum(areas),totalCapacityJPerK:sum(zones.map(z=>z.capacityJPerK)),
      ratedSensibleWPerUnit:h.coolingKwPerUnit*1000*settings.shr,ratedInputKwPerUnit:h.inputKwPerUnit,
      lightingTotalW:42*18,windowAreaTotalM2:sum(windows),
      sources:{positions:'用户2026-10-13确认：南窗侧一台靠西、一台靠东，朝北送风，可以分别开机；西/东标签未绑定铭牌序号',
        geometry:'四区编号沿用已验收模块1；各区面积按独立比例假设，未从座位数推算实测面积',
        physics:'https://bigladdersoftware.com/epx/docs/23-1/engineering-reference/hybrid-model.html#zone-air-heat-balance-algorithm'},
      limitations:[
        '本模型是四节点显热近似，未校准，不是EnergyPlus运行结果或经过验证的数字孪生',
        '总面积378㎡、南墙长27m、层高、热容、围护与混合系数为假设；各区面积并未实测',
        '仅计南外墙、窗和外气渗透，其余围护暂作绝热；可能低估或误分配真实负荷',
        '太阳得热归于南侧两区并作为即时显热，储热合并到等效热容；不解析太阳斑和独立墙体温度',
        '42根灯本模块固定全开并按假设面积分配显热；不引用旧照明采光分区或重新计算照度',
        '两台对四区均供冷，覆盖比例未知；没有风道隔离，空区仍可能接受制冷并与有人的区换热',
        '平均供冷比例和部分负荷耗电曲线为情景，不是可用的变频指令或实测负载率；忽略待机、风机和启动耗电；16—40℃外仅作不合理状态诊断',
        '无湿量方程、实际盘管曲线、舒适实测和温度校准；23—24℃只检查情景室温，不能证明体感舒适',
        '本模块固定供冷情景，不自动选择动作、不开环钳制温度、不生成三策略节电率'
      ]};
  }
  function solve(matrix,rhs){
    const a=matrix.map((row,i)=>[...row,rhs[i]]),n=rhs.length;
    for(let k=0;k<n;k++){
      let pivot=k;for(let i=k+1;i<n;i++)if(Math.abs(a[i][k])>Math.abs(a[pivot][k]))pivot=i;
      if(Math.abs(a[pivot][k])<1e-12)throw new Error('Singular heat-balance matrix');
      [a[k],a[pivot]]=[a[pivot],a[k]];
      const d=a[k][k];for(let j=k;j<=n;j++)a[k][j]/=d;
      for(let i=0;i<n;i++)if(i!==k){const factor=a[i][k];for(let j=k;j<=n;j++)a[i][j]-=factor*a[k][j];}
    }
    return a.map(row=>row[n]);
  }
  function cooling(modeId,fraction,p){
    const mode=modes.find(m=>m.id===modeId);if(!mode)throw new Error('Unknown cooling state');
    fraction=number(fraction,.3,0,1,'average cooling fraction');
    const unitCoolingW=mode.enabled.map(on=>on?p.ratedSensibleWPerUnit*fraction:0);
    const unitInputKw=mode.enabled.map(on=>on&&fraction>0?p.ratedInputKwPerUnit*fraction/(1-p.settings.cyclingCoefficient+p.settings.cyclingCoefficient*fraction):0);
    return {modeId,fraction,unitCoolingW,unitInputKw,zoneCoolingW:p.zones.map((_,i)=>sum(unitCoolingW.map((q,j)=>q*p.coolingShares[j][i]))),hvacInputKw:sum(unitInputKw)};
  }
  function gains(record,counts,p){
    if(!record||!Number.isFinite(record.outdoorTemperatureC)||!Number.isFinite(record.southVerticalIrradianceWm2)||record.southVerticalIrradianceWm2<0)throw new Error('Missing current weather');
    const people=vector(counts,'zone people',0,314);people.forEach((v,i)=>{if(!Number.isInteger(v)||v>p.zones[i].capacity)throw new Error('Invalid regional occupancy capacity');});
    const curtainFactor=1-p.settings.curtainClosedFraction*(1-buildingInputs.assumptions.curtainSolarMultiplierClosed);
    return p.zones.map((z,i)=>({peopleW:people[i]*p.settings.peopleSensibleW,
      lightsW:p.lightingTotalW*z.assumedAreaM2/p.totalAreaM2,
      solarW:z.windowAreaM2*p.settings.shgc*curtainFactor*record.southVerticalIrradianceWm2}));
  }
  function step(temperatures,record,counts,modeId,fraction,p,seconds=p.settings.timeStepSeconds){
    const before=vector(temperatures,'temperatures',-Infinity,Infinity),dt=number(seconds,60,.000001,300,'step seconds'),load=gains(record,counts,p),ac=cooling(modeId,fraction,p);
    const matrix=p.zones.map((z,i)=>p.zones.map((_,j)=>i===j?z.capacityJPerK/dt+z.outdoorConductanceWPerK:0));
    for(const link of p.links){const {i,j,conductanceWPerK:k}=link;matrix[i][i]+=k;matrix[j][j]+=k;matrix[i][j]-=k;matrix[j][i]-=k;}
    const rhs=p.zones.map((z,i)=>z.capacityJPerK/dt*before[i]+z.outdoorConductanceWPerK*record.outdoorTemperatureC+load[i].peopleW+load[i].lightsW+load[i].solarW-ac.zoneCoolingW[i]);
    // Backward Euler: all boundary fluxes evaluated at the same end temperature.
    const after=solve(matrix,rhs),mixingW=[0,0,0,0];
    for(const {i,j,conductanceWPerK:k} of p.links){const q=k*(after[j]-after[i]);mixingW[i]+=q;mixingW[j]-=q;}
    const zones=p.zones.map((z,i)=>{
      const outdoorW=z.outdoorConductanceWPerK*(record.outdoorTemperatureC-after[i]);
      const internalW=load[i].peopleW+load[i].lightsW+load[i].solarW;
      const storedJ=z.capacityJPerK*(after[i]-before[i]);
      const netW=outdoorW+internalW+mixingW[i]-ac.zoneCoolingW[i];
      return {id:z.id,temperatureBeforeC:before[i],temperatureAfterC:after[i],people:counts[i],...load[i],outdoorW,mixingW:mixingW[i],coolingW:ac.zoneCoolingW[i],storedJ,netW,balanceResidualJ:storedJ-netW*dt};
    });
    const ledger={peopleJ:sum(zones.map(z=>z.peopleW))*dt,lightsJ:sum(zones.map(z=>z.lightsW))*dt,
      solarJ:sum(zones.map(z=>z.solarW))*dt,outdoorJ:sum(zones.map(z=>z.outdoorW))*dt,
      mixingJ:sum(mixingW)*dt,coolingJ:sum(ac.zoneCoolingW)*dt,storedJ:sum(zones.map(z=>z.storedJ))};
    ledger.residualJ=ledger.storedJ-(ledger.peopleJ+ledger.lightsJ+ledger.solarJ+ledger.outdoorJ-ledger.coolingJ);
    return {temperaturesC:after,zones,ledger,seconds:dt,...ac,hvacKwh:ac.hvacInputKw*dt/3600};
  }
  function simulate(segments,p,input={}){
    if(!Array.isArray(segments)||segments.length===0)throw new Error('Missing thermal input segments');
    let temperatures=vector(input.initialTemperaturesC??[24,24,24,24],'initial temperatures');
    const initial=[...temperatures],modeId=input.modeId??'off',fraction=number(input.averageCoolingFraction,.3,0,1,'average cooling fraction');
    cooling(modeId,fraction,p);
    const samples=[{minute:0,temperaturesC:[...temperatures]}],ledger={peopleJ:0,lightsJ:0,solarJ:0,outdoorJ:0,mixingJ:0,coolingJ:0,storedJ:0,residualJ:0};
    let elapsed=0,hvacKwh=0,maxStepResidualJ=0,occupiedZoneMinutes=0,withinRangeZoneMinutes=0,hotDegreeMinutes=0,coldDegreeMinutes=0,peakOccupiedC=null,minOccupiedC=null;
    for(const segment of segments){
      const duration=number(segment.seconds,1800,1,7200,'segment duration');gains(segment.record,segment.counts,p);
      let used=0;
      while(used<duration-1e-8){
        const dt=Math.min(p.settings.timeStepSeconds,duration-used),before=temperatures;
        const result=step(before,segment.record,segment.counts,modeId,fraction,p,dt);temperatures=result.temperaturesC;
        for(let i=0;i<4;i++)if(segment.counts[i]>0){
          occupiedZoneMinutes+=dt/60;
          if(before[i]>=23-1e-9&&before[i]<=24+1e-9&&temperatures[i]>=23-1e-9&&temperatures[i]<=24+1e-9)withinRangeZoneMinutes+=dt/60;
          hotDegreeMinutes+=(Math.max(0,before[i]-24)+Math.max(0,temperatures[i]-24))*.5*dt/60;
          coldDegreeMinutes+=(Math.max(0,23-before[i])+Math.max(0,23-temperatures[i]))*.5*dt/60;
          peakOccupiedC=Math.max(peakOccupiedC??-Infinity,before[i],temperatures[i]);minOccupiedC=Math.min(minOccupiedC??Infinity,before[i],temperatures[i]);
        }
        for(const key of Object.keys(ledger))ledger[key]+=result.ledger[key];
        maxStepResidualJ=Math.max(maxStepResidualJ,Math.abs(result.ledger.residualJ),...result.zones.map(z=>Math.abs(z.balanceResidualJ)));
        hvacKwh+=result.hvacKwh;elapsed+=dt;used+=dt;
        samples.push({minute:elapsed/60,temperaturesC:[...temperatures],counts:[...segment.counts],zoneCoolingW:[...result.zoneCoolingW]});
      }
    }
    return {modeId,name:modes.find(m=>m.id===modeId).name,averageCoolingFraction:fraction,minutes:elapsed/60,
      initialTemperaturesC:initial,finalTemperaturesC:[...temperatures],hvacKwh,
      storedChangeKwhThermal:sum(p.zones.map((z,i)=>z.capacityJPerK*(temperatures[i]-initial[i])))/J_PER_KWH,
      occupiedZoneMinutes,withinRangeZoneMinutes,withinRangePct:occupiedZoneMinutes?withinRangeZoneMinutes/occupiedZoneMinutes*100:null,
      hotDegreeMinutes,coldDegreeMinutes,peakOccupiedC,minOccupiedC,samples,ledger,maxStepResidualJ,
      temperatureValidation:'有人区每步起点和终点室温23—24℃，不保证采样间连续达标；空区不套用有人区约束',
      outsideAssumedOperatingRange:samples.some(s=>s.temperaturesC.some(t=>t<16||t>40)),
      isControlStrategy:false,isMeasured:false};
  }
  function preview(record,artifact,input={}){
    const demand=spatialOccupancyModel.buildDemand(record,artifact,{currentPattern:input.currentPattern??'west',futurePattern:input.futurePattern??'same',
      ...(Object.hasOwn(input,'currentPeople')?{currentPeople:input.currentPeople}:{})});
    const minutes=number(input.minutes,30,30,60,'preview duration');if(minutes!==30&&minutes!==60)throw new Error('Choose 30 or 60 minutes');
    if(minutes===60&&!demand.future)throw new Error('No next-day demand available');
    const segments=[{record,counts:demand.current.counts,seconds:1800}];
    if(minutes===60)segments.push({record,counts:demand.future.counts,seconds:1800});
    const p=parameters(input);
    return {version:1,module:'spatial-heat-only',demand,parameters:p,segments,
      modes:modes.map(mode=>simulate(segments,p,{...input,modeId:mode.id})),
      inputScope:'当前人数保持30分钟；若选60分钟，后半段用冻结预测总数按情景分区；全窗口天气与灯热保持起点值，不读取未来实际需求或天气。固定供冷状态，不含自动调控。',
      nextModule:'未开始模块3；平均供冷比例手动给定，未将预测转换为控制动作。'};
  }
  function sensitivity(segments,input={}){
    const cases=[];
    for(const ownSegmentShare of [.5,.7,.85])for(const mixingWPerK of [50,300,1000])for(const massMultiplier of [5,10,20])cases.push({...input,ownSegmentShare,mixingWPerK,massMultiplier,southAreaFraction:.5,westAreaFraction:.5});
    for(const southAreaFraction of [.4,.5,.6])for(const westAreaFraction of [.4,.5,.6])if(southAreaFraction!==.5||westAreaFraction!==.5)cases.push({...input,ownSegmentShare:.7,mixingWPerK:300,massMultiplier:10,southAreaFraction,westAreaFraction});
    const results=cases.map(c=>{const p=parameters(c);return {settings:p.settings,modes:modes.map(m=>{const r=simulate(segments,p,{...input,modeId:m.id});return {id:m.id,finalTemperaturesC:r.finalTemperaturesC,peakOccupiedC:r.peakOccupiedC,minOccupiedC:r.minOccupiedC,withinRangePct:r.withinRangePct,hvacKwh:r.hvacKwh,maxStepResidualJ:r.maxStepResidualJ};})};});
    return {caseCount:results.length,trajectoryCount:results.length*4,results,
      note:'27个覆盖/混合/热容组合，另加8个面积比例组合；共35情景。不是置信区间，也未覆盖全部不确定性；初始温度、湿度、窗分配和设备性能仍需另检验。'};
  }
  return {modes,parameters,cooling,gains,step,simulate,preview,sensitivity};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=spatialThermalModel;
