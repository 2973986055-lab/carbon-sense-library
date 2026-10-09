'use strict';

// A transparent, uncalibrated rule simulation. This is not a trained predictor.
// Kept separate from study-model.js so the report's five-day reference stays fixed.
const interactiveModel = (() => {
  const rules = { referencePeople: 294, referenceTemperature: 27, referenceLoad: .82,
    peopleWeight: .35, temperatureWeight: .035, minLoad: .4, maxLoad: 1,
    comfortStart: 27, comfortLimit: 29, realtimeSpareTubes: 3, predictiveSpareTubes: 2,
    realtimeAcSaving: .05, predictiveAcSaving: .09, hours: 2 };
  const finite = (value, fallback) => value == null || String(value).trim() === '' || typeof value === 'boolean'
    ? fallback : Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const presets = {
    quiet: { people: 100, temperature: 27, hours: 2, mode: 'predictive' },
    peak: { people: 314, temperature: 27, hours: 2, mode: 'predictive' },
    hot: { people: 314, temperature: 32, hours: 2, mode: 'predictive' },
    empty: { people: 0, temperature: 26, hours: 2, mode: 'predictive' }
  };
  function normalizeNumeric(raw, { min, max, step, fallback }) {
    const invalid = raw == null || String(raw).trim() === '' || !Number.isFinite(Number(raw));
    const parsed = invalid ? fallback : Number(raw);
    const bounded = clamp(parsed, min, max);
    const value = Number(clamp(min + Math.round((bounded - min) / step) * step, min, max).toFixed(3));
    return { value, invalid, adjusted: invalid || value !== parsed };
  }
  function calculate(input = {}) {
    if (!input || typeof input !== 'object') input = {};
    const people = Math.round(clamp(finite(input.people, rules.referencePeople), 0, study.facts.seats));
    const temperature = clamp(finite(input.temperature, rules.referenceTemperature), 22, 34);
    const hours = clamp(finite(input.hours, rules.hours), .5, 8);
    const automaticLoad = Math.round(clamp(rules.referenceLoad + rules.peopleWeight * (people - rules.referencePeople) / study.facts.seats
      + rules.temperatureWeight * (temperature - rules.referenceTemperature), rules.minLoad, rules.maxLoad) * 1000) / 1000;
    const manualLoad = input.loadOverride != null;
    const baselineLoad = manualLoad ? clamp(finite(input.loadOverride, automaticLoad), rules.minLoad, rules.maxLoad) : automaticLoad;
    const baseLighting = study.lightingKw * hours, baseHvac = study.hvacKw * baselineLoad * hours;
    const baselineEnergy = baseLighting + baseHvac;
    const comfortMargin = clamp((rules.comfortLimit - temperature) / (rules.comfortLimit - rules.comfortStart), 0, 1);
    const demandTubes = Math.ceil(people / study.facts.seats * study.facts.lighting.count);
    const modes = [
      { id: 'fixed', name: '固定全开', spare: 0, acSaving: 0 },
      { id: 'realtime', name: '实时感知', spare: rules.realtimeSpareTubes, acSaving: rules.realtimeAcSaving },
      { id: 'predictive', name: '预测协同', spare: rules.predictiveSpareTubes, acSaving: rules.predictiveAcSaving }
    ].map(policy => {
      let tubes = policy.id === 'fixed' ? study.facts.lighting.count
        : people === 0 ? 0 : Math.min(study.facts.lighting.count, demandTubes + policy.spare);
      let acSaving = policy.acSaving * comfortMargin;
      const manual = input.overrideMode === policy.id && (input.tubesOverride != null || input.acSavingOverride != null);
      if (input.overrideMode === policy.id) {
        if (input.tubesOverride != null) tubes = Math.round(clamp(finite(input.tubesOverride, tubes), 0, study.facts.lighting.count));
        if (input.acSavingOverride != null) acSaving = clamp(finite(input.acSavingOverride, acSaving), 0, .15) * (temperature >= rules.comfortLimit ? 0 : 1);
      }
      // Empty-room shutdown is only a scenario assumption; never a hardware instruction.
      const hvacOff = people === 0 && policy.id !== 'fixed';
      if (hvacOff) acSaving = 0;
      const hvacLoad = hvacOff ? 0 : baselineLoad * (1 - acSaving);
      const lightingKw = tubes * study.facts.lighting.wattPerTube / 1000, hvacKw = study.hvacKw * hvacLoad;
      const lightingEnergy = lightingKw * hours, hvacEnergy = hvacKw * hours;
      const energy = lightingEnergy + hvacEnergy, saved = baselineEnergy - energy;
      return { ...policy, tubes, leftTubes: Math.ceil(tubes / 2), rightTubes: Math.floor(tubes / 2), manual,
        acSaving, hvacOff, hvacLoad, lightingKw, hvacKw, lightingEnergy, hvacEnergy, energy, saved,
        lightingSaved: baseLighting - lightingEnergy, hvacSaved: baseHvac - hvacEnergy,
        savingPct: saved / baselineEnergy * 100, carbonSaved: saved * study.facts.scenario.carbonKgPerKwh };
    });
    return { people, temperature, hours, automaticLoad, manualLoad, baselineLoad, baselineEnergy,
      baselineLighting: baseLighting, baselineHvac: baseHvac, comfortMargin, modes };
  }
  return { rules, presets, normalizeNumeric, calculate };
})();

