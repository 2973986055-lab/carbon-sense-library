'use strict';

// Statistical reservation-demand experiment, not measured first-floor occupancy.
const reservationModel = (() => {
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  function fit(days) {
    if (!Array.isArray(days) || !days.length || days.some(day => !Array.isArray(day) || day.length !== 48 || day.some(n => !Number.isFinite(n) || n < 0))) {
      throw new Error('Expected complete nonnegative 48-slot days');
    }
    return { profile: Array.from({length:48}, (_, slot) => days.reduce((sum, day) => sum + day[slot], 0) / days.length),
      referencePeak: Math.max(...days.flat()) };
  }
  function rawForecast(profile, slot, current, weight) {
    if (!Array.isArray(profile) || profile.length !== 48 || profile.some(n => !Number.isFinite(n) || n < 0) || !Number.isInteger(slot) || slot < 0 || slot > 46 || !Number.isFinite(current) || current < 0 || !Number.isFinite(weight) || weight < 0 || weight > 1) {
      throw new Error('Invalid forecast input');
    }
    return Math.max(0, profile[slot + 1] + weight * (current - profile[slot]));
  }
  function score(model, day, method, weight = 0) {
    const points = Array.from({length:47}, (_, slot) => {
      const predicted = method === 'persistence' ? day[slot] : rawForecast(model.profile, slot, day[slot], method === 'profile' ? 0 : weight);
      return {slot:slot+1, actual:day[slot+1], predicted, active:model.profile[slot+1] > 0};
    });
    const metrics = list => ({ count:list.length,
      mae:list.length ? list.reduce((sum, p) => sum + Math.abs(p.predicted - p.actual), 0) / list.length : null,
      rmse:list.length ? Math.sqrt(list.reduce((sum, p) => sum + (p.predicted - p.actual) ** 2, 0) / list.length) : null });
    return {active:metrics(points.filter(p => p.active)), all:metrics(points), points};
  }
  function selectWeight(days) {
    const candidates = [0, .25, .5, .75, 1].map(weight => {
      let errors = 0, count = 0;
      for (let i = 1; i < days.length; i++) {
        const scored = score(fit(days.slice(0, i)), days[i], 'adjusted', weight);
        errors += scored.active.mae * scored.active.count; count += scored.active.count;
      }
      return {weight, mae:errors / count, count};
    });
    if (!Number.isFinite(candidates[0].mae)) throw new Error('No nonzero training targets to validate');
    candidates.sort((a, b) => a.mae - b.mae || a.weight - b.weight);
    return {weight:candidates[0].weight, candidates};
  }
  function validateRegisteredDays(days, capacity) {
    if (!Array.isArray(days) || !days.length || !Number.isFinite(capacity) || capacity <= 0) throw new Error('Invalid registered calibration inputs');
    fit(days.map(day => day.counts));
    for (let i = 0; i < days.length; i++) {
      const day = days[i], maximum = capacity * .5 * day.counts.filter(n => n > 0).length;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || (i > 0 && days[i-1].date >= day.date)
          || !Number.isFinite(day.floorRegisteredHours) || day.floorRegisteredHours < 0 || day.floorRegisteredHours > maximum) {
        throw new Error('Expected chronological days and feasible registered hours');
      }
    }
  }
  function fitRegisteredMapping(days, capacity = 314) {
    validateRegisteredDays(days, capacity);
    // Each daily integral is piecewise linear in the coefficient. Search every
    // interval's quadratic minimum, rather than tuning on the held-out days.
    const boundaries = [...new Set([0, ...days.flatMap(day => day.counts.filter(n => n > 0).map(n => capacity / n))])].sort((a,b) => a-b);
    const hours = (day, coefficient) => day.counts.reduce((sum,n) => sum + Math.min(capacity, coefficient*n)*.5, 0);
    let best = {coefficient:0, squaredHourError:days.reduce((sum,day) => sum + day.floorRegisteredHours**2,0)};
    for (let i=0; i<boundaries.length-1; i++) {
      const low=boundaries[i], high=boundaries[i+1], middle=(low+high)/2;
      const terms=days.map(day => ({
        slope:day.counts.reduce((sum,n) => sum + (middle*n < capacity ? n*.5 : 0),0),
        intercept:day.counts.reduce((sum,n) => sum + (middle*n >= capacity ? capacity*.5 : 0),0),
        target:day.floorRegisteredHours
      }));
      const denominator=terms.reduce((sum,t) => sum+t.slope**2,0);
      const optimum=denominator ? terms.reduce((sum,t) => sum+t.slope*(t.target-t.intercept),0)/denominator : low;
      const coefficient=clamp(optimum,low,high);
      const squaredHourError=days.reduce((sum,day) => sum+(hours(day,coefficient)-day.floorRegisteredHours)**2,0);
      if (squaredHourError < best.squaredHourError) best={coefficient,squaredHourError};
    }
    return {...best, capacity, trainingDates:days.map(day=>day.date),
      dailyFits:days.map(day => ({date:day.date,registeredHours:day.floorRegisteredHours,
        fittedHours:hours(day,best.coefficient),residualHours:hours(day,best.coefficient)-day.floorRegisteredHours})),
      definition:'由训练日签到至签退总时长拟合的有上限尺度系数，含暂离，不是真实分区比例'};
  }
  function registeredProxy(mapping, libraryCount) {
    if (!Number.isFinite(libraryCount) || libraryCount < 0 || !Number.isFinite(mapping.coefficient) || mapping.coefficient < 0
        || !Number.isFinite(mapping.capacity) || mapping.capacity <= 0) throw new Error('Invalid registered proxy input');
    return Math.min(mapping.capacity, mapping.coefficient * libraryCount);
  }
  function registeredProfile(days, mapping) {
    return Array.from({length:48},(_,slot) => days.reduce((sum,day) => sum+registeredProxy(mapping,day.counts[slot]),0)/days.length);
  }
  function retrospectiveReference(day, capacity=314) {
    const mapping=fitRegisteredMapping([day],capacity);
    return {values:day.counts.map(n=>registeredProxy(mapping,n)),mapping,
      definition:'仅供事后对照的含暂离登记人数情景，不是实际在座真值，也不是预测输入'};
  }
  function floorScore(profile, mapping, day, method, weight) {
    const reference=retrospectiveReference(day,mapping.capacity);
    const points=Array.from({length:47},(_,slot) => {
      // The current input is derived using TRAINING-ONLY mapping. The held-out
      // day's final registered hours appear only in the comparison target.
      const current=registeredProxy(mapping,day.counts[slot]);
      const predicted=method==='persistence' ? current : clamp(rawForecast(profile,slot,current,method==='profile'?0:weight),0,mapping.capacity);
      return {slot:slot+1,current,predicted,actual:reference.values[slot+1],active:profile[slot+1]>0};
    });
    const metrics=list=>({count:list.length,
      mae:list.length ? list.reduce((sum,p)=>sum+Math.abs(p.predicted-p.actual),0)/list.length : null,
      rmse:list.length ? Math.sqrt(list.reduce((sum,p)=>sum+(p.predicted-p.actual)**2,0)/list.length) : null});
    return {active:metrics(points.filter(p=>p.active)),all:metrics(points),points,
      rollingPredictedRegisteredHours:points.reduce((sum,p)=>sum+p.predicted*.5,0)+profile[0]*.5,
      registeredHoursReference:day.floorRegisteredHours,referenceDefinition:reference.definition};
  }
  function selectFloorWeight(days, capacity=314) {
    validateRegisteredDays(days,capacity);
    const folds=days.slice(1).map((day,index) => {
      const training=days.slice(0,index+1),mapping=fitRegisteredMapping(training,capacity);
      return {day,mapping,profile:registeredProfile(training,mapping)};
    });
    const candidates=[0,.25,.5,.75,1].map(weight=>{
      let errors=0,count=0;
      for(const fold of folds) {
        const scored=floorScore(fold.profile,fold.mapping,fold.day,'adjusted',weight);
        errors+=scored.active.mae*scored.active.count;count+=scored.active.count;
      }
      return {weight,mae:count ? errors/count : null,count};
    });
    if(!Number.isFinite(candidates[0].mae)) throw new Error('No training floor-proxy targets');
    candidates.sort((a,b)=>a.mae-b.mae||a.weight-b.weight);
    return {weight:candidates[0].weight,candidates,
      folds:folds.map(f=>({trainingDates:f.mapping.trainingDates,targetDate:f.day.date})),
      scope:'训练期逐日扩展；起点代理仅由此前日期参数与当刻全馆计数生成；目标为事后登记时长情景'};
  }
  function fitFrozen(days, capacity=314) {
    validateRegisteredDays(days,capacity);
    const full=fit(days.map(day=>day.counts)),selection=selectWeight(days.map(day=>day.counts));
    const floorMapping=fitRegisteredMapping(days,capacity),floorSelection=selectFloorWeight(days,capacity);
    return {...full,weight:selection.weight,selection,floorMapping,floorWeight:floorSelection.weight,
      floorSelection,floorProfile:registeredProfile(days,floorMapping),trainingDates:days.map(day=>day.date)};
  }
  function scoreRegistered(artifact, day, method='adjusted') {
    return floorScore(artifact.floorProfile,artifact.floorMapping,day,method,artifact.floorWeight);
  }
  function transfer(artifact, slot, current) {
    if (!Number.isFinite(current) || current < 0 || current > 314 || !artifact.floorMapping || !Array.isArray(artifact.floorProfile)) throw new Error('Invalid transfer input');
    const scale=artifact.floorMapping.coefficient, profile=artifact.floorProfile;
    const raw=rawForecast(profile,slot,current,artifact.floorWeight);
    const bounded=clamp(raw,0,314);
    return {slot, targetSlot:slot+1, current, profileCurrent:profile[slot], profileNext:profile[slot+1], raw,
      people:Math.round(bounded), clipped:raw > 314, scale,
      historicalZero:artifact.profile[slot+1] === 0};
  }
  return {fit, rawForecast, score, selectWeight, fitRegisteredMapping, registeredProxy,
    retrospectiveReference, selectFloorWeight, fitFrozen, scoreRegistered, transfer};
})();
