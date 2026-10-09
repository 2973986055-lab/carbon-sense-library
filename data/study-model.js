'use strict';

// STUDY_INPUTS_BEGIN
const studyInputs = {
  revision: '2026-10-09',
  seats: 314,
  lighting: { count: 42, wattPerTube: 18, groups: 14, tubesPerGroup: 3, tubesPerSide: 21, type: 'T8 LED' },
  hvac: { count: 2, inputKwPerUnit: 9.18, coolingKwPerUnit: 28, model: 'KFRd-280LW/730A' },
  scenario: {
    hoursPerDay: 15.5,
    dates: ['6月24日', '6月25日', '6月26日', '6月27日', '6月28日'],
    representativePeople: [288, 291, 296, 300, 294],
    acLoadFactors: [0.72, 0.75, 0.82, 0.88, 0.84],
    realtimeLightingSaving: 0.09,
    realtimeAcSaving: 0.05,
    predictiveLightingSaving: 0.16,
    predictiveAcSaving: 0.09,
    carbonKgPerKwh: 0.6516,
    carbonFactorYear: 2023,
    carbonFactorRegion: '河北省',
    carbonFactorSource: 'https://www.mee.gov.cn/xxgk2018/xxgk/xxgk01/202512/t20251231_1139517.html'
  }
};
// STUDY_INPUTS_END

const study = (() => {
  const facts = studyInputs, s = facts.scenario;
  const lightingKw = facts.lighting.count * facts.lighting.wattPerTube / 1000;
  const hvacKw = facts.hvac.count * facts.hvac.inputKwPerUnit;
  const dailyLighting = s.dates.map(() => lightingKw * s.hoursPerDay);
  const dailyHvac = s.acLoadFactors.map(f => hvacKw * s.hoursPerDay * f);
  const sum = values => values.reduce((a, b) => a + b, 0);
  const lightingKwh = sum(dailyLighting), hvacKwh = sum(dailyHvac);
  const baseline = lightingKwh + hvacKwh;
  const modes = [
    { name: '固定全开', lightingSaving: 0, acSaving: 0 },
    { name: '实时感知', lightingSaving: s.realtimeLightingSaving, acSaving: s.realtimeAcSaving },
    { name: '预测协同', lightingSaving: s.predictiveLightingSaving, acSaving: s.predictiveAcSaving }
  ].map(mode => {
    const lighting = lightingKwh * (1 - mode.lightingSaving);
    const hvac = hvacKwh * (1 - mode.acSaving);
    const energy = lighting + hvac, saved = baseline - energy;
    return { ...mode, lighting, hvac, energy, saved, savingPct: saved / baseline * 100,
      carbon: energy * s.carbonKgPerKwh, carbonSaved: saved * s.carbonKgPerKwh,
      daily: dailyLighting.map((light, i) => light * (1 - mode.lightingSaving) + dailyHvac[i] * (1 - mode.acSaving)) };
  });
  function estimateTwoHours(closedTubes, acLoadFactor, acSavingRate) {
    const count = Math.max(0, Math.min(42, Math.round(closedTubes)));
    const load = Math.max(0, Math.min(1, acLoadFactor));
    const rate = Math.max(0, Math.min(0.15, acSavingRate));
    const base = (lightingKw + hvacKw * load) * 2;
    const saved = count * facts.lighting.wattPerTube / 1000 * 2 + hvacKw * load * rate * 2;
    return { base, saved, energy: base - saved, savingPct: base ? saved / base * 100 : 0,
      carbonSaved: saved * s.carbonKgPerKwh, lightingKw: (42 - count) * facts.lighting.wattPerTube / 1000 };
  }
  return { facts, lightingKw, hvacKw, fullRatedKw: lightingKw + hvacKw,
    dailyLighting, dailyHvac, lightingKwh, hvacKwh, modes, estimateTwoHours };
})();
