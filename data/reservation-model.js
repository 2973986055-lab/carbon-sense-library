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
  function transfer(artifact, slot, current) {
    if (!Number.isFinite(current) || current < 0 || current > 314 || !Number.isFinite(artifact.referencePeak) || artifact.referencePeak <= 0) throw new Error('Invalid transfer input');
    const scale = 314 / artifact.referencePeak;
    const profile = artifact.profile.map(n => n * scale);
    const raw = rawForecast(profile, slot, current, artifact.weight);
    const bounded = clamp(raw, 0, 314);
    return {slot, targetSlot:slot+1, current, profileCurrent:profile[slot], profileNext:profile[slot+1], raw,
      people:Math.round(bounded), clipped:raw > 314, scale,
      historicalZero:artifact.profile[slot+1] === 0};
  }
  return {fit, rawForecast, score, selectWeight, transfer};
})();
