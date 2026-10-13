'use strict';

// Offline single-zone scenario experiment. This does not issue hardware commands.
// Minute integration is a numerical resolution; inputs remain half-hour proxies.
const controlScenarioModel = (() => {
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const number = (x, fallback) => x == null || x === '' || typeof x === 'boolean' || !Number.isFinite(Number(x)) ? fallback : Number(x);
  const definitions = [
    {id:'fixed',name:'日常基准',rule:'日常使用时段保留供冷许可，采用共同的室温反馈与请求保持规则；42根顶灯全开'},
    {id:'realtime',name:'实时感知情景',rule:'当前占用许可下按室温反馈请求或暂停两台共同供冷；分区照明响应当前占用与模型照度'},
    {id:'predictive',name:'预测协同情景',rule:'用下一半小时人数预测估计热负荷与30分钟室温轨迹，在同一室温约束下选择当前供冷或暂停；照明沿用前瞻关灯保护'}
  ];
  const methodSource = 'https://energyplus.readthedocs.io/en/v26.2.0/guides/engineering-reference/13.4-hybrid-model.html';
  function settings(input = {}) {
    const physics = thermalModel.defaults(input), lighting = zoneLightingModel.settings(input);
    const lead = number(input.leadMinutes, 0);
    return {...physics,...lighting,
      initialTemperatureC:clamp(number(input.initialTemperatureC,28),18,35),
      thermalMassMultiplier:clamp(number(input.thermalMassMultiplier,10),1,30),
      baselineSetpointC:clamp(number(input.baselineSetpointC,24),23,24),
      leadMinutes:[0,15,30].includes(lead) ? lead : 0,
      hvacPolicy:input.hvacPolicy==='ideal'?'ideal':'lookahead',
      hvacForecast:input.hvacForecast==='persistence'?'persistence':'frozen',
      minimumRequestOnMinutes:clamp(Math.round(number(input.minimumRequestOnMinutes,5)),1,15),
      minimumRequestOffMinutes:clamp(Math.round(number(input.minimumRequestOffMinutes,5)),1,15),
      feedbackStopTemperatureC:clamp(number(input.feedbackStopTemperatureC,23.5),23,23.9),
      requestSwitchCostWh:clamp(number(input.requestSwitchCostWh,0),0,50),
      predictionHorizonMinutes:30,
      eveningShutdownFromMinute:clamp(number(input.eveningShutdownFromMinute,21*60),18*60,23*60+30),
      occupiedTemperatureRangeC:[23,24],controlTargetC:24,stepSeconds:60
    };
  }
  function plant(input = {}) {
    const s = settings(input), g = buildingInputs.geometry, hvac = buildingInputs.equipment.hvac;
    const airCapacityJPerK = 1.2 * 1006 * g.floorAreaM2 * s.heightM;
    const southOpaqueAreaM2 = 27 * s.heightM - g.windowAreaM2;
    const conductanceWPerK = s.glassU * g.windowAreaM2 + s.opaqueU * southOpaqueAreaM2 + airCapacityJPerK * s.ach / 3600;
    const capacityJPerK=airCapacityJPerK*s.thermalMassMultiplier;
    const minuteDecay=Math.exp(-conductanceWPerK*60/capacityJPerK);
    return {settings:s,airCapacityJPerK,capacityJPerK,minuteDecay,
      minuteResponseKPerW:conductanceWPerK<1e-9?60/capacityJPerK:-Math.expm1(-conductanceWPerK*60/capacityJPerK)/conductanceWPerK,
      conductanceWPerK,ratedSensibleCoolingW:hvac.count*hvac.coolingKwPerUnit*1000*s.shr,
      ratedInputKw:hvac.count*hvac.inputKwPerUnit};
  }
  function gainsW(record, people, tubes, s) {
    const g = buildingInputs.geometry;
    const curtainFactor = 1-s.curtainClosedFraction*(1-buildingInputs.assumptions.curtainSolarMultiplierClosed);
    return people*s.peopleHeatW*s.sensibleFraction + tubes*buildingInputs.equipment.lighting.wattPerTube
      + g.windowAreaM2*s.shgc*curtainFactor*record.southVerticalIrradianceWm2;
  }
  function advanceTemperature(temperatureC, outdoorC, gains, coolingW, p, seconds = 60) {
    const h = p.conductanceWPerK, c = p.capacityJPerK;
    if (h < 1e-9) return temperatureC + (gains-coolingW)*seconds/c;
    const equilibrium = outdoorC + (gains-coolingW)/h;
    return equilibrium + (temperatureC-equilibrium)*Math.exp(-h*seconds/c);
  }
  function step(temperatureC, record, people, tubes, enabled, targetC, p) {
    const gains = gainsW(record,people,tubes,p.settings);
    const freeTemperature = advanceTemperature(temperatureC,record.outdoorTemperatureC,gains,0,p);
    const responseKPerW = p.conductanceWPerK < 1e-9 ? 60/p.capacityJPerK
      : -Math.expm1(-p.conductanceWPerK*60/p.capacityJPerK)/p.conductanceWPerK;
    const requiredCoolingW = Math.max(0,(freeTemperature-targetC)/responseKPerW);
    const coolingW = enabled ? Math.min(p.ratedSensibleCoolingW,requiredCoolingW) : 0;
    const ratio = coolingW/p.ratedSensibleCoolingW;
    const fraction = 1-p.settings.cyclingCoefficient+p.settings.cyclingCoefficient*ratio;
    const hvacKw = p.ratedInputKw*ratio/fraction;
    const lightingKw = tubes*buildingInputs.equipment.lighting.wattPerTube/1000;
    return {temperatureC:advanceTemperature(temperatureC,record.outdoorTemperatureC,gains,coolingW,p),
      coolingW,requiredCoolingW,hvacKw,lightingKw,hvacKwh:hvacKw/60,lightingKwh:lightingKw/60,
      energyKwh:(hvacKw+lightingKw)/60,
      capacityLimited:enabled && requiredCoolingW>p.ratedSensibleCoolingW+1e-6};
  }
  function anticipation(artifact, slot, currentPeople, offsetMinute, leadMinutes) {
    if (leadMinutes===0 || slot>=47 || currentPeople>0 || offsetMinute<30-leadMinutes) return {enabled:false,forecastPeople:null};
    // Only the frozen training profile and the currently available count enter.
    const forecast = reservationModel.transfer(artifact,slot,currentPeople);
    return {enabled:forecast.people>0,forecastPeople:forecast.people};
  }
  // All policies use this SAME actuator approximation. A request authorizes
  // joint cooling; average output is limited by capacity and a 23C lower guard.
  // This is not a verified Haier compressor model or a hardware setpoint command.
  function requestStep(temperatureC,record,people,tubes,requestOn,p) {
    const gains=gainsW(record,people,tubes,p.settings);
    const freeTemperature=record.outdoorTemperatureC+(temperatureC-record.outdoorTemperatureC)*p.minuteDecay+gains*p.minuteResponseKPerW;
    const availableAboveLowerW=Math.max(0,(freeTemperature-23)/p.minuteResponseKPerW);
    const coolingW=requestOn?Math.min(p.ratedSensibleCoolingW,availableAboveLowerW):0;
    const ratio=coolingW/p.ratedSensibleCoolingW;
    const hvacKw=p.ratedInputKw*ratio/(1-p.settings.cyclingCoefficient+p.settings.cyclingCoefficient*ratio);
    const lightingKw=tubes*buildingInputs.equipment.lighting.wattPerTube/1000;
    return {temperatureC:freeTemperature-coolingW*p.minuteResponseKPerW,freeTemperatureC:freeTemperature,
      gainsW:gains,coolingW,hvacKw,lightingKw,hvacKwh:hvacKw/60,lightingKwh:lightingKw/60,
      energyKwh:(hvacKw+lightingKw)/60,
      capacityLimited:requestOn&&Math.max(0,(freeTemperature-24)/p.minuteResponseKPerW)>p.ratedSensibleCoolingW+1e-6};
  }
  function requestState(){return {on:false,lastChangeMinute:-Infinity};}
  function permittedRequests(memory,minute,s) {
    const hold=memory.on?s.minimumRequestOnMinutes:s.minimumRequestOffMinutes;
    return minute-memory.lastChangeMinute<hold?[memory.on]:[false,true];
  }
  function applyRequest(memory,wanted,minute,s) {
    const permitted=permittedRequests(memory,minute,s),locked=!permitted.includes(wanted);
    const next=locked?memory.on:wanted,changed=next!==memory.on;
    if(changed){memory.on=next;memory.lastChangeMinute=minute;}
    return {on:memory.on,changed,locked};
  }
  function feedbackRequest(temperatureC,record,people,tubes,allowed,memory,p) {
    if(!allowed)return false;
    // A current-input, one-minute crossing guard compensates the numerical step.
    const free=requestStep(temperatureC,record,people,tubes,false,p).temperatureC;
    if(free>=24-1e-8)return true;
    if(temperatureC<=p.settings.feedbackStopTemperatureC+1e-8) {
      // All policies share this current-load protection check. It assumes
      // today's current inputs persist for the OFF hold, with no future count.
      const pauseEnd=advanceTemperature(temperatureC,record.outdoorTemperatureC,gainsW(record,people,tubes,p.settings),0,p,60*p.settings.minimumRequestOffMinutes);
      return pauseEnd>24+1e-8;
    }
    return memory.on;
  }
  function roomViolation(before,after,occupied) {
    if(!occupied)return 0;
    return (Math.max(0,before-24)+Math.max(0,after-24)+Math.max(0,23-before)+Math.max(0,23-after))/2;
  }
  function forecastInputs(record,artifact,offset,p) {
    const next=record.slot<47&&p.settings.hvacForecast==='frozen'?reservationModel.transfer(artifact,record.slot,record.floorReservationProxy).people:record.floorReservationProxy;
    const remaining=30-offset;
    return {peopleNext:next,targetOffsetMinutes:remaining,
      people:Array.from({length:30},(_,i)=>i<remaining?record.floorReservationProxy:next),
      occupied:Array.from({length:30},(_,i)=>i<remaining?record.floorReservationProxy>0:next>0)};
  }
  function evaluateRequest(action,temperatureC,record,tubes,minute,memory,p,forecast) {
    const m={...memory},first=applyRequest(m,action,minute,p.settings);
    const firstHold=action?p.settings.minimumRequestOnMinutes:p.settings.minimumRequestOffMinutes;
    let temperature=temperatureC,energy=0,violation=0,switches=first.changed?1:0,min=temperature,max=temperature;
    const temperatures=[];let firstViolation=0,pauseGuard=0;
    if(!action&&record.floorReservationProxy>0) {
      let paused=temperatureC;
      for(let i=0;i<p.settings.minimumRequestOffMinutes;i++) {
        const next=requestStep(paused,record,record.floorReservationProxy,tubes,false,p).temperatureC;
        pauseGuard+=roomViolation(paused,next,true);paused=next;
      }
    }
    for(let i=0;i<30;i++) {
      if(i>=firstHold) {
        let wanted=feedbackRequest(temperature,record,forecast.people[i],tubes,forecast.occupied[i],m,p);
        if(!wanted&&forecast.occupied[i]) {
          let paused=temperature;
          for(let j=i;j<i+p.settings.minimumRequestOffMinutes;j++) {
            const at=Math.min(29,j),next=requestStep(paused,record,forecast.people[at],tubes,false,p).temperatureC;
            if(forecast.occupied[at]&&Math.max(paused,next)>24+1e-8)wanted=true;
            paused=next;
          }
        }
        const command=applyRequest(m,wanted,minute+i,p.settings);if(command.changed)switches++;
      }
      const result=requestStep(temperature,record,forecast.people[i],tubes,m.on,p);
      const error=roomViolation(temperature,result.temperatureC,forecast.occupied[i]);
      violation+=error;if(i===0)firstViolation=error;
      if(i+1===forecast.targetOffsetMinutes&&forecast.peopleNext>0)
        violation+=Math.max(0,result.temperatureC-24)+Math.max(0,23-result.temperatureC);
      temperature=result.temperatureC;energy+=result.hvacKwh;
      min=Math.min(min,temperature);max=Math.max(max,temperature);temperatures.push(temperature);
    }
    // Normalize candidate terminal thermal storage to the same starting state.
    // This is an objective correction at rated sensible COP, not consumed kWh.
    // Otherwise a short horizon rewards leaving a warmer room to the next run.
    const terminalEquivalentKwh=p.capacityJPerK*(temperature-temperatureC)/3.6e6/(p.ratedSensibleCoolingW/(p.ratedInputKw*1000));
    return {requestOn:action,energyKwh:energy,terminalEquivalentKwh,
      violationDegreeMinutes:violation,firstViolationDegreeMinutes:firstViolation,currentPauseGuardDegreeMinutes:pauseGuard,switches,
      objectiveKwh:energy+terminalEquivalentKwh+switches*p.settings.requestSwitchCostWh/1000,
      minimumTemperatureC:min,maximumTemperatureC:max,endTemperatureC:temperature,temperatures};
  }
  function predictiveRequest(temperatureC,record,tubes,allowed,minute,memory,p,artifact,offset) {
    const forecast=forecastInputs(record,artifact,offset,p);
    const permitted=permittedRequests(memory,minute,p.settings);
    const actions=allowed?permitted:[permitted.includes(false)?false:true];
    const candidates=actions.map(on=>evaluateRequest(on,temperatureC,record,tubes,minute,memory,p,forecast));
    candidates.sort((a,b)=>{
      if(Math.abs(a.firstViolationDegreeMinutes-b.firstViolationDegreeMinutes)>1e-7)return a.firstViolationDegreeMinutes-b.firstViolationDegreeMinutes;
      if(Math.abs(a.currentPauseGuardDegreeMinutes-b.currentPauseGuardDegreeMinutes)>1e-7)return a.currentPauseGuardDegreeMinutes-b.currentPauseGuardDegreeMinutes;
      const av=a.violationDegreeMinutes<=1e-7,bv=b.violationDegreeMinutes<=1e-7;
      if(av!==bv)return av?-1:1;
      if(!av&&!bv&&Math.abs(a.violationDegreeMinutes-b.violationDegreeMinutes)>1e-7)return a.violationDegreeMinutes-b.violationDegreeMinutes;
      return a.objectiveKwh-b.objectiveKwh||Number(b.requestOn===memory.on)-Number(a.requestOn===memory.on);
    });
    const chosen=candidates[0];
    return {wanted:chosen.requestOn,forecastPeople:forecast.peopleNext,
      forecastInternalSolarGainsW:gainsW(record,forecast.peopleNext,tubes,p.settings),
      forecastHeatW:gainsW(record,forecast.peopleNext,tubes,p.settings)+p.conductanceWPerK*(record.outdoorTemperatureC-temperatureC),
      targetOffsetMinutes:forecast.targetOffsetMinutes,
      feasible:chosen.violationDegreeMinutes<=1e-7&&chosen.currentPauseGuardDegreeMinutes<=1e-7,candidates,chosen,
      reason:!allowed?'当前无供冷许可；遵守请求保持时间':candidates.length===1?'请求保持时间尚未结束':
        chosen.violationDegreeMinutes>1e-7?'保持当前温度优先后，预测候选仍有越界；选择温度偏差较小者':
        chosen.requestOn?'预测轨迹约束内选择供冷请求':'预测轨迹约束内选择暂停请求'};
  }
  function validateDay(records) {
    if (!Array.isArray(records) || records.length!==48) throw new Error('Expected 48 half-hour inputs for one day');
    const date = records[0].date;
    records.forEach((r,i)=>{
      if(r.date!==date || r.slot!==i || !Number.isFinite(r.outdoorTemperatureC)
        || !Number.isFinite(r.southVerticalIrradianceWm2) || r.southVerticalIrradianceWm2<0
        || !Number.isInteger(r.floorReservationProxy) || r.floorReservationProxy<0 || r.floorReservationProxy>314) throw new Error('Invalid or unordered day inputs');
    });
  }
  function simulateDay(records, artifact, input = {}) {
    validateDay(records);
    const p = plant(input), s = p.settings;
    const states = definitions.map(d=>({...d,temperatureC:s.initialTemperatureC,
      hvacKwh:0,lightingKwh:0,energyKwh:0,occupiedMinutes:0,withinRangeMinutes:0,
      aboveRangeDegreeMinutes:0,belowRangeDegreeMinutes:0,capacityLimitedMinutes:0,
      firstArrivalTemperatureC:null,firstCoolingMinute:null,preArrivalCoolingMinutes:0,unoccupiedCoolingMinutes:0,
      enabledMinutes:0,trace:[],endTemperatureC:null,occupiedSeatMinutes:0,withinLuxSeatMinutes:0,
      insufficientLightingMinutes:0,illuminanceDeficitSeatLuxMinutes:0,
      lightingSwitchOperations:0,lightingWithinSessionSwitchOperations:0,forecastLightingGuardMinutes:0,
      hvacRequestState:requestState(),hvacRequestSwitches:0,hvacRequestOnMinutes:0,
      protectionBlockedMinutes:0,predictedInfeasibleMinutes:0,
      minimumOccupiedTemperatureC:Infinity,maximumOccupiedTemperatureC:-Infinity,sumOccupiedTemperatureC:0,
      lightingState:zoneLightingModel.state()}));
    let sessionOpen=false,hasOpened=false;
    let lightingOutlook=null;
    for(let minute=0;minute<1440;minute++) {
      const slot=Math.floor(minute/30),offset=minute%30,r=records[slot],people=r.floorReservationProxy;
      if(people>0) {sessionOpen=true;hasOpened=true;}
      else if(hasOpened && minute>=s.eveningShutdownFromMinute) sessionOpen=false;
      // The same hypothetical occupancy map enters every mode. Actual light heat differs.
      const pre=anticipation(artifact,slot,people,offset,s.leadMinutes);
      if(offset===0)lightingOutlook=slot<47 ? {
        ...zoneLightingModel.daylightOutlook(r,slot>0?records[slot-1]:null),
        people:reservationModel.transfer(artifact,slot,people).people,targetSlot:slot+1
      } : null;
      for(const mode of states) {
        const lighting=zoneLightingModel.control(r,minute,sessionOpen,mode.id,s,mode.lightingState,lightingOutlook);
        const tubes=lighting.tubesOn;
        const enabled=mode.id==='fixed' ? sessionOpen : people>0 || (mode.id==='predictive'&&pre.enabled);
        const before=mode.temperatureC;
        if(people>0 && mode.firstArrivalTemperatureC===null) mode.firstArrivalTemperatureC=before;
        let decision=null,command=null,result;
        if(s.hvacPolicy==='ideal')result=step(before,r,people,tubes,enabled,mode.id==='fixed'?s.baselineSetpointC:s.controlTargetC,p);
        else {
          const dwellLimited=permittedRequests(mode.hvacRequestState,minute,s).length===1;
          const wanted=mode.id==='predictive'?(decision=predictiveRequest(before,r,tubes,enabled,minute,mode.hvacRequestState,p,artifact,offset)).wanted
            :feedbackRequest(before,r,people,tubes,enabled,mode.hvacRequestState,p);
          command=applyRequest(mode.hvacRequestState,wanted,minute,s);
          result=requestStep(before,r,people,tubes,command.on,p);
          if(command.changed)mode.hvacRequestSwitches++;
          if(command.on)mode.hvacRequestOnMinutes++;
          if(dwellLimited)mode.protectionBlockedMinutes++;
          if(decision&&!decision.feasible)mode.predictedInfeasibleMinutes++;
        }
        mode.temperatureC=result.temperatureC;mode.hvacKwh+=result.hvacKwh;
        mode.lightingKwh+=result.lightingKwh;mode.energyKwh+=result.energyKwh;
        mode.occupiedSeatMinutes+=people;mode.withinLuxSeatMinutes+=lighting.withinLuxPeople;
        if(lighting.insufficientAtFull)mode.insufficientLightingMinutes++;
        mode.illuminanceDeficitSeatLuxMinutes+=lighting.deficitSeatLux;
        mode.lightingSwitchOperations+=lighting.switchOperations;
        mode.lightingWithinSessionSwitchOperations+=lighting.withinSessionSwitchOperations;
        if(lighting.forecastGuardActive)mode.forecastLightingGuardMinutes++;
        if(enabled) mode.enabledMinutes++;
        if(result.hvacKw>1e-8) {
          if(mode.firstCoolingMinute===null) mode.firstCoolingMinute=minute;
          if(people===0) {
            mode.unoccupiedCoolingMinutes++;
            if(mode.firstArrivalTemperatureC===null)mode.preArrivalCoolingMinutes++;
          }
        }
        if(result.capacityLimited) mode.capacityLimitedMinutes++;
        if(people>0) {
          mode.occupiedMinutes++;
          // With constant inputs the one-minute response is monotone. Both
          // endpoints must satisfy the room constraint; no temperature clipping.
          if(Math.min(before,mode.temperatureC)>=23-1e-7 && Math.max(before,mode.temperatureC)<=24+1e-7)mode.withinRangeMinutes++;
          mode.aboveRangeDegreeMinutes+=(Math.max(0,before-24)+Math.max(0,mode.temperatureC-24))/2;
          mode.belowRangeDegreeMinutes+=(Math.max(0,23-before)+Math.max(0,23-mode.temperatureC))/2;
          mode.minimumOccupiedTemperatureC=Math.min(mode.minimumOccupiedTemperatureC,before,mode.temperatureC);
          mode.maximumOccupiedTemperatureC=Math.max(mode.maximumOccupiedTemperatureC,before,mode.temperatureC);
          mode.sumOccupiedTemperatureC+=(before+mode.temperatureC)/2;
        }
        mode.trace.push({minute,slot,people,enabled,tubes,temperatureC:mode.temperatureC,
          temperatureBeforeC:before,hvacRequestOn:command?command.on:null,
          requestChanged:command?command.changed:false,protectionLocked:command?command.locked:false,
          gainsW:gainsW(r,people,tubes,s),heatLoadW:gainsW(r,people,tubes,s)+p.conductanceWPerK*(r.outdoorTemperatureC-before),coolingW:result.coolingW,
          hvacDecision:decision?{forecastPeople:decision.forecastPeople,forecastHeatW:decision.forecastHeatW,
            forecastInternalSolarGainsW:decision.forecastInternalSolarGainsW,
            targetOffsetMinutes:decision.targetOffsetMinutes,feasible:decision.feasible,reason:decision.reason,
            chosen:{...decision.chosen,temperatures:undefined},
            candidates:decision.candidates.map(({temperatures,...summary})=>summary)}:null,
          southVerticalIrradianceWm2:r.southVerticalIrradianceWm2,
          hvacKw:result.hvacKw,lightingKw:result.lightingKw,cumulativeKwh:mode.energyKwh,
          lightingZones:minute%30===0?lighting.zones:null,
          lightingForecast:mode.id==='predictive'&&minute%30===0?lightingOutlook:null,
          forecastPeople:mode.id==='predictive' ? pre.forecastPeople : null});
      }
    }
    const baseline=states[0];
    for(const mode of states) {
      mode.endTemperatureC=mode.temperatureC;
      mode.temperatureCompliancePct=mode.occupiedMinutes ? mode.withinRangeMinutes/mode.occupiedMinutes*100 : null;
      mode.savedKwh=baseline.energyKwh-mode.energyKwh;
      mode.savingPct=baseline.energyKwh>0 ? mode.savedKwh/baseline.energyKwh*100 : null;
      mode.illuminanceCompliancePct=s.lightingPolicy==='fixed'?null:mode.occupiedSeatMinutes?mode.withinLuxSeatMinutes/mode.occupiedSeatMinutes*100:null;
      mode.lightingSavedKwh=baseline.lightingKwh-mode.lightingKwh;
      mode.hvacSavedKwh=baseline.hvacKwh-mode.hvacKwh;
      mode.meanOccupiedTemperatureC=mode.occupiedMinutes?mode.sumOccupiedTemperatureC/mode.occupiedMinutes:null;
      if(!mode.occupiedMinutes){mode.minimumOccupiedTemperatureC=null;mode.maximumOccupiedTemperatureC=null;}
      delete mode.lightingState;
      delete mode.hvacRequestState;
    }
    const date=records[0].date;
    const predictionEvaluationStatus=['2026-06-24','2026-06-25','2026-06-26','2026-06-27','2026-06-28'].includes(date)
      ? '训练期回放，历史曲线包含该日拟合信息，仅作演示'
      : '训练期外情景回放，人数曲线未由本日拟合；仍不是实测控制验证';
    return {date,predictionEvaluationStatus,settings:s,plant:p,modes:states,
      scope:'单日连续温度与用电情景；人员为训练期登记时长校准的含暂离代理，非一楼实际在座；未校准，非实测节电',
      rules:definitions,
      assumptions:[
        '相同代理需求、历史天气、初始室温和建筑参数；每半小时输入保持不变，1分钟为数值步长',
        '23—24℃约束的是有人期间模型室温，设备设定值未映射到硬件；默认反馈停止阈值23.5℃，当前输入预计下一分钟达到24℃时请求供冷，两台共同动作',
        s.hvacPolicy==='ideal'?'旧理想恒温对照：平均供冷直接追踪24℃，仅供历史复算':'共同执行器近似：供冷请求下按容量上限制冷，理想内部调节防止额外制冷低于23℃；不是海尔压缩机或完整温控实测模型，不含风机待机及启动能量',
        `供冷/暂停请求各至少保持${s.minimumRequestOnMinutes}/${s.minimumRequestOffMinutes}分钟，三策略共用；参数为情景假设，不是已核实海尔保护时间，不能把请求切换次数称为压缩机启停次数`,
        '预测每分钟仅比较当前供冷与暂停两种请求，第一段按共同保持时间执行，后续用实时反馈回放；先选择室温约束可行候选，再比较预测电量加请求切换代价；不是完整优化器或已验证MPC',
        `预测模拟窗口30分钟：下一采样点人数由${s.hvacForecast==='frozen'?'五训二验冻结模型':'人数保持不变对照'}提供；当前人数保持至下一采样点，再采用预测值；天气与灯功率保持起点值，均是假设，未读取未来实际天气/需求/灯光动作`,
        `请求切换代价每次${s.requestSwitchCostWh}Wh仅是目标函数权衡参数，不计入实际电量，不代表启动耗电或寿命费用；不可行时报告偏差，不用裁剪室温制造达标`,
        '候选目标函数按相同起点温度补偿末端热蓄存差：C×(末温－初温)÷额定显热COP；这是未校准的目标修正，不计入实际电量，用于避免短窗口将供冷负担推到下一窗口',
        '初始室温28℃、有效热容倍数10均为假设；室温状态在一天内连续，每天初值独立',
        '21:00以后首次当前代理人数为零视为夜间关闭；21:00为可编辑情景边界，非实际闭馆时间',
        '当前代理占用被当作控制器已知情景输入，不代表已接入实时感知；实际系统不据预约自动停机',
        s.lightingPolicy==='fixed'?'三模式42根顶灯采用相同日间全开规则；原对照不评价照度':'仅计42根18W顶灯，按14个假设分区、每区3根分配到314座；每侧157座与21根，未核实灯位-座位覆盖',
        '全开基准、实时与预测面对相同空间占用假设；预测照明仅对新关灯加前瞻保护，不预设节电率，不保证优于实时',
        `空置区延时${s.vacancyDelayMinutes}分钟尝试减灯；每次减灯需占用区平均模型照度达到${s.targetLux}lx，全开仍不足的区则不得低于全开可提供的照度，保留所有影响该区的灯；其他区可继续试减。关灯动作间隔至少5分钟，光不足立即恢复`,
        '照度是区域平均光通量法加粗略自然光；占用分布、利用/维护系数、采光因子及10%相邻区光通量均为假设。不验证桌面最低值、均匀度、眩光或照明合规。ERA5辐射不是实测照度',
        '预测照明用冻结模型的下一半小时人数及同一分布假设；采光取当前值与最近半小时下降趋势的保守外推，忽略上升趋势，不读取未来实际人数或辐射，不预测突发云遮。只暂缓关灯，不提前开启空置区',
        '控制运行时仅用当前和此前输入与冻结历史曲线；6/24—28为含拟合信息的训练期回放，不作独立检验；采光外推未单独训练或验证；相同室温范围不代表相同室温轨迹，结果同时展示平均室温和期末室温以提示热蓄存差异',
        '只评价温度范围，不代表湿度、CO₂或综合热舒适达标；制冷系统没有供热功能'
      ],methodSource};
  }
  function leadComparison(records, artifact, input = {}) {
    return [0,15,30].map(leadMinutes=>{
      const result=simulateDay(records,artifact,{...input,leadMinutes});
      const m=result.modes[2];
      return {leadMinutes,energyKwh:m.energyKwh,savedKwh:m.savedKwh,temperatureCompliancePct:m.temperatureCompliancePct,
        firstArrivalTemperatureC:m.firstArrivalTemperatureC,preArrivalCoolingMinutes:m.preArrivalCoolingMinutes};
    });
  }
  function sensitivity(records, artifact, input = {}) {
    const summaries=[];
    for(const thermalMassMultiplier of [5,10,20]) for(const initialTemperatureC of [24,26,28]) {
      const result=simulateDay(records,artifact,{...input,thermalMassMultiplier,initialTemperatureC});
      summaries.push({thermalMassMultiplier,initialTemperatureC,modes:result.modes.map(m=>({id:m.id,energyKwh:m.energyKwh,
        savedKwh:m.savedKwh,temperatureCompliancePct:m.temperatureCompliancePct}))});
    }
    return {scenarios:9,rows:summaries,note:'初始室温24/26/28℃与有效热容倍数5/10/20的9组假设，不是测量范围或置信区间'};
  }
  return {definitions,methodSource,settings,plant,advanceTemperature,step,requestStep,requestState,
    permittedRequests,applyRequest,feedbackRequest,forecastInputs,evaluateRequest,predictiveRequest,
    anticipation,simulateDay,leadComparison,sensitivity};
})();

if(typeof module!=='undefined'&&module.exports)module.exports=controlScenarioModel;
