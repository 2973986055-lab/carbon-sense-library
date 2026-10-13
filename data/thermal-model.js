'use strict';

// Scenario calculation, not a calibrated building/AC digital twin.
// Three policies share actual demand and weather; a predictor alone does not
// create energy savings. No pre-assigned saving percentages are used here.
const thermalModel = (() => {
  const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
  function numeric(x, fallback) {
    return x == null || x === '' || typeof x === 'boolean' || !Number.isFinite(Number(x)) ? fallback : Number(x);
  }
  function saturationPressurePa(temperatureC) {
    if (!Number.isFinite(temperatureC) || temperatureC < -40 || temperatureC > 60) throw new Error('Invalid temperature');
    return 610.94 * Math.exp(17.625 * temperatureC / (temperatureC + 243.04));
  }
  function humidityRatio(temperatureC, rhPct, pressurePa = 101325) {
    if (!Number.isFinite(rhPct) || rhPct < 0 || rhPct > 100 || !Number.isFinite(pressurePa) || pressurePa < 50000) throw new Error('Invalid humidity');
    const vaporPressure = saturationPressurePa(temperatureC) * rhPct / 100;
    if (vaporPressure >= pressurePa) throw new Error('Invalid vapor pressure');
    return 0.62198 * vaporPressure / (pressurePa - vaporPressure);
  }
  function relativeHumidity(temperatureC, ratio, pressurePa = 101325) {
    if (!Number.isFinite(ratio) || ratio < 0) throw new Error('Invalid humidity ratio');
    return 100 * pressurePa * ratio / (0.62198 + ratio) / saturationPressurePa(temperatureC);
  }
  function defaults(input = {}) {
    const a = buildingInputs.assumptions;
    return {
      heightM: clamp(numeric(input.heightM, a.ceilingHeightM), 3.3, 5),
      ach: clamp(numeric(input.ach, a.infiltrationAch), 0, 3),
      glassU: clamp(numeric(input.glassU, a.glassUValueWm2K), 0.5, 8),
      opaqueU: clamp(numeric(input.opaqueU, a.opaqueUValueWm2K), 0.1, 4),
      shgc: clamp(numeric(input.shgc, a.solarHeatGainCoefficient), 0, 1),
      curtainClosedFraction: clamp(numeric(input.curtainClosedFraction, 0), 0, 1),
      initialRhPct: clamp(numeric(input.initialRhPct, a.initiallyAssumedRhPct), 20, 90),
      shr: clamp(numeric(input.shr, a.coilSensibleHeatRatio), 0.5, 0.95),
      peopleHeatW: clamp(numeric(input.peopleHeatW, a.peopleTotalHeatW), 60, 180),
      sensibleFraction: clamp(numeric(input.sensibleFraction, a.peopleSensibleFraction), 0.3, 0.9),
      coilAdpC: clamp(numeric(input.coilAdpC, a.coilApparatusDewPointC), 5, 18),
      cyclingCoefficient: clamp(numeric(input.cyclingCoefficient, a.genericCyclingLossCoefficient), 0, 0.3)
    };
  }
  function calculate(record, input = {}) {
    if (!record || !Number.isFinite(record.outdoorTemperatureC) || !Number.isFinite(record.outdoorRelativeHumidityPct)
      || !Number.isFinite(record.southVerticalIrradianceWm2) || record.southVerticalIrradianceWm2 < 0) throw new Error('Missing outdoor weather or south-window radiation');
    const settings = defaults(input);
    const people = Math.round(clamp(numeric(input.people, record.floorReservationProxy), 0, 314));
    // A reservation proxy is not an observation of vacancy. Operation is a
    // separate scenario input; zero people does not silently switch equipment off.
    const acRunning = input.acRunning !== false;
    const active = acRunning;
    const hours = clamp(numeric(input.hours, 0.5), 0.1, 8);
    const setpointC = clamp(numeric(input.setpointC, buildingInputs.operation.baselineSetpointC), 22, 28);
    const lighting = buildingInputs.equipment.lighting;
    const tubes = Math.round(clamp(numeric(input.tubes, buildingInputs.operation.baselineLightsOn), 0, lighting.count));
    const volumeM3 = buildingInputs.geometry.floorAreaM2 * settings.heightM;
    const pressurePa = numeric(record.surfacePressureHpa, 1013.25) * 100;
    const densityKgM3 = 1.2, specificHeatJkgK = 1006, latentHeatJkg = 2450000;
    const dryAirMassKg = densityKgM3 * volumeM3;
    const exchangeKgS = dryAirMassKg * settings.ach / 3600;
    const deltaTemperature = record.outdoorTemperatureC - setpointC;
    const windowAreaM2 = buildingInputs.geometry.windowAreaM2;
    const opaqueSouthAreaM2 = 27 * settings.heightM - windowAreaM2;
    const curtainFactor = 1 - settings.curtainClosedFraction * (1 - buildingInputs.assumptions.curtainSolarMultiplierClosed);
    const heatGainsW = {
      people: people * settings.peopleHeatW * settings.sensibleFraction,
      lights: tubes * lighting.wattPerTube,
      solar: windowAreaM2 * settings.shgc * curtainFactor * record.southVerticalIrradianceWm2,
      glassConduction: settings.glassU * windowAreaM2 * deltaTemperature,
      southWallConduction: settings.opaqueU * opaqueSouthAreaM2 * deltaTemperature,
      airExchange: exchangeKgS * specificHeatJkgK * deltaTemperature
    };
    const sensibleLoadW = Math.max(0, Object.values(heatGainsW).reduce((sum, n) => sum + n, 0));
    const requiredTotalCoolingW = sensibleLoadW / settings.shr;
    const hvac = buildingInputs.equipment.hvac;
    const ratedTotalCoolingW = hvac.count * hvac.coolingKwPerUnit * 1000;
    const ratedInputKw = hvac.count * hvac.inputKwPerUnit;
    const coolingW = acRunning ? Math.min(ratedTotalCoolingW, requiredTotalCoolingW) : 0;
    const coolingLoadRatio = coolingW / ratedTotalCoolingW;
    const partLoadFraction = 1 - settings.cyclingCoefficient + settings.cyclingCoefficient * coolingLoadRatio;
    const electricalEquivalentLoadRatio = coolingLoadRatio / partLoadFraction;
    const hvacInputKw = ratedInputKw * electricalEquivalentLoadRatio;
    const lightingInputKw = tubes * lighting.wattPerTube / 1000;
    const sensibleUnmetW = Math.max(0, sensibleLoadW - coolingW * settings.shr);
    const outdoorW = humidityRatio(record.outdoorTemperatureC, record.outdoorRelativeHumidityPct, pressurePa);
    let indoorW = humidityRatio(setpointC, settings.initialRhPct, pressurePa);
    const coilFloorW = humidityRatio(settings.coilAdpC, 100, pressurePa);
    const peopleMoistureKgS = people * settings.peopleHeatW * (1 - settings.sensibleFraction) / latentHeatJkg;
    const coilLatentW = coolingW * (1 - settings.shr);
    const steps = Math.ceil(hours * 3600 / 60), dt = hours * 3600 / steps;
    let removedWaterKg = 0;
    for (let i = 0; i < steps; i++) {
      if (exchangeKgS > 0) {
        const attenuation = Math.exp(-exchangeKgS / dryAirMassKg * dt);
        indoorW = outdoorW + (indoorW - outdoorW) * attenuation
          + peopleMoistureKgS / exchangeKgS * (1 - attenuation);
      } else indoorW += peopleMoistureKgS * dt / dryAirMassKg;
      const removed = Math.min(coilLatentW / latentHeatJkg * dt, Math.max(0, indoorW - coilFloorW) * dryAirMassKg);
      indoorW -= removed / dryAirMassKg; removedWaterKg += removed;
    }
    const rawHumidity = relativeHumidity(setpointC, indoorW, pressurePa);
    const assumptionsInvalid = !active || sensibleUnmetW > 1 || rawHumidity > 100;
    const humidityEstimatePct = assumptionsInvalid ? null : rawHumidity;
    return {people, active, acRunning, enabledAcUnits:acRunning ? hvac.count : 0,
      ratedTotalCoolingKw: ratedTotalCoolingW / 1000, ratedInputKw,
      hours, setpointC, tubes, settings, volumeM3, heatGainsW,
      sensibleLoadKw:sensibleLoadW / 1000, requiredCoolingKw:requiredTotalCoolingW / 1000,
      deliveredCoolingKw:coolingW / 1000, coolingLoadRatio, electricalEquivalentLoadRatio,
      hvacInputKw, lightingInputKw, hvacKwh:hvacInputKw * hours, lightingKwh:lightingInputKw * hours,
      energyKwh:(hvacInputKw + lightingInputKw) * hours, sensibleUnmetKw:sensibleUnmetW / 1000,
      peopleMoistureKgPerHour:peopleMoistureKgS * 3600,
      humidityEstimatePct, rawHumidityPct:rawHumidity, removedWaterKg,
      humidityCondition:'目标室温可维持、初始湿度为情景输入、固定盘管显热比等假设下的短时估算，不是实测或已验证湿度预测',
      flags:[...(!acRunning ? ['两台空调关闭为人工选择情景；实际室温未知，不显示恒温湿度结果'] : []),
        ...(people === 0 ? ['人数为零仅是输入情景，不作为空调或照明停机依据'] : []),
        ...(acRunning && sensibleUnmetW > 1 ? ['假设工况下制冷能力不足，目标温度和湿度估算不成立'] : []),
        ...(rawHumidity > 100 ? ['达到饱和，需要凝结与动态温度模型，不显示虚假的百分比'] : [])]};
  }
  function compare(record, input = {}) {
    const range = buildingInputs.operation.reportedSetpointRangeC;
    const baselineSetpointC = clamp(numeric(input.baselineSetpointC, buildingInputs.operation.baselineSetpointC), range[0], range[1]);
    const baselineTubes = Math.round(clamp(numeric(input.baselineTubes, buildingInputs.operation.baselineLightsOn), 0, buildingInputs.equipment.lighting.count));
    const baseline = calculate(record, {...input, setpointC:baselineSetpointC, tubes:baselineTubes});
    const optimizedSetpointC = clamp(numeric(input.optimizedSetpointC, baselineSetpointC), 22, 28);
    const optimizedTubes = Math.round(clamp(numeric(input.optimizedTubes, baselineTubes), 0, buildingInputs.equipment.lighting.count));
    const controlled = calculate(record, {...input, setpointC:optimizedSetpointC, tubes:optimizedTubes});
    const make = (id, name, result) => ({id, name, ...result,
      savedKwh:baseline.energyKwh-result.energyKwh,
      savingPct:baseline.energyKwh > 0 ? (baseline.energyKwh-result.energyKwh)/baseline.energyKwh*100 : null});
    return {baseline, baselineSetpointC, baselineTubes, optimizedSetpointC, optimizedTubes,
      modes:[make('fixed','日常运行基准',baseline),make('realtime','实时感知情景',controlled),make('predictive','预测协同情景',controlled)],
      policyNote:`日常基准${baselineSetpointC}℃、${baseline.tubes}根灯、${baseline.enabledAcUnits}台空调；默认策略与基准相同，节电为零。两个优化模式使用同一策略和运行状态；改变设定温度的用电差不是预测算法收益，尚无提前控制收益证据。减少灯管或改变设定温度仅是用户选择的情景，未验证照度与舒适度，也未控制硬件。`};
  }
  function sensitivity(record, input = {}) {
    const results = [];
    for (const heightM of [3.3,4]) for (const ach of [0.3,1]) for (const initialRhPct of [45,65]) for (const shr of [0.65,0.85]) {
      results.push(calculate(record,{...input,heightM,ach,initialRhPct,shr}));
    }
    const validRh = results.map(r => r.humidityEstimatePct).filter(Number.isFinite);
    return {scenarios:results.length,
      energyKwhRange:[Math.min(...results.map(r=>r.energyKwh)),Math.max(...results.map(r=>r.energyKwh))],
      humidityRangePct:validRh.length ? [Math.min(...validRh),Math.max(...validRh)] : null,
      invalidHumidityScenarios:results.length-validRh.length,
      note:'层高3.3/4m、换气0.3/1次每小时、初始湿度45/65%、盘管显热比0.65/0.85的16个组合情景，不是统计置信区间；未覆盖全部建筑和设备不确定性'};
  }
  function compareSensitivity(record, input = {}) {
    const pairs = [];
    for (const heightM of [3.3,4]) for (const ach of [0.3,1]) for (const initialRhPct of [45,65]) for (const shr of [0.65,0.85]) {
      pairs.push(compare(record,{...input,heightM,ach,initialRhPct,shr}));
    }
    const saved = pairs.map(pair=>pair.modes[1].savedKwh);
    const ratios = pairs.map(pair=>pair.modes[1].savingPct).filter(Number.isFinite);
    return {scenarios:pairs.length,
      savedKwhRange:[Math.min(...saved),Math.max(...saved)],
      savingPctRange:ratios.length ? [Math.min(...ratios),Math.max(...ratios)] : null,
      capacityInsufficientScenarios:pairs.filter(pair=>pair.baseline.sensibleUnmetKw > .001 || pair.modes[1].sensibleUnmetKw > .001).length,
      note:'同一组建筑假设、人数、天气和设备运行状态分别计算基准与策略，再求用电差；16组合范围不是置信区间，亦不证明照度或舒适度满足要求'};
  }
  return {saturationPressurePa, humidityRatio, relativeHumidity, defaults, calculate, compare, sensitivity, compareSensitivity};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = thermalModel;
