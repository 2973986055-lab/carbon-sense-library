const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const context = vm.createContext({});
for (const file of ['study-model.js', 'interactive-model.js']) vm.runInContext(fs.readFileSync(path.join(root, 'data', file), 'utf8'), context);
const model = vm.runInContext('interactiveModel', context);
const reference = vm.runInContext('study', context);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const check = scenario => {
  assert.equal(scenario.modes.length, 3);
  for (const mode of scenario.modes) {
    assert.ok(Number.isFinite(mode.energy) && mode.energy >= 0);
    assert.ok(mode.energy <= scenario.baselineEnergy + 1e-9);
    assert.ok(mode.tubes >= 0 && mode.tubes <= 42);
    assert.equal(mode.leftTubes + mode.rightTubes, mode.tubes);
    assert.ok(mode.leftTubes <= 21 && mode.rightTubes <= 21);
    assert.ok(mode.hvacLoad >= 0 && mode.hvacLoad <= 1);
    near(mode.energy + mode.saved, scenario.baselineEnergy);
    near(mode.energy, (mode.lightingKw + mode.hvacKw) * 2);
    near(mode.carbonSaved, mode.saved * .6516);
    near(mode.savingPct, mode.saved / scenario.baselineEnergy * 100);
  }
};
let cases = 0;
for (let people = 0; people <= 314; people++) for (let temperature = 22; temperature <= 34; temperature++) {
  const scenario = model.calculate({ people, temperature });
  check(scenario);
  near(scenario.modes[0].energy, scenario.baselineEnergy);
  assert.equal(scenario.modes[0].tubes, 42);
  if (temperature >= 29 && people > 0) for (const mode of scenario.modes) near(mode.hvacLoad, scenario.baselineLoad);
  if (people === 0) for (const mode of scenario.modes.slice(1)) {
    assert.equal(mode.tubes, 0); assert.equal(mode.hvacLoad, 0); assert.equal(mode.energy, 0);
  }
  if (people > 0) assert.ok(scenario.modes[2].energy <= scenario.modes[1].energy + 1e-9);
  if (people > 0) {
    const previous = model.calculate({ people: people - 1, temperature });
    scenario.modes.forEach((mode, i) => assert.ok(mode.energy >= previous.modes[i].energy - 1e-9));
  }
  if (temperature > 22) {
    const previous = model.calculate({ people, temperature: temperature - 1 });
    scenario.modes.forEach((mode, i) => assert.ok(mode.energy >= previous.modes[i].energy - 1e-9));
  }
  cases++;
}
for (const overrideMode of ['fixed', 'realtime', 'predictive']) for (let tubesOverride = 0; tubesOverride <= 42; tubesOverride++)
  for (const temperature of [22, 27, 28, 29, 34]) for (const acSavingOverride of [0, .05, .09, .15]) {
    const scenario = model.calculate({ people: 100, temperature, overrideMode, tubesOverride, acSavingOverride });
    const mode = scenario.modes.find(mode => mode.id === overrideMode);
    check(scenario); assert.equal(mode.tubes, tubesOverride); assert.equal(mode.manual, true);
    if (temperature >= 29) assert.equal(mode.acSaving, 0);
    const original = model.calculate({ people: 100, temperature });
    scenario.modes.forEach((mode, i) => { if (mode.id !== overrideMode) near(mode.energy, original.modes[i].energy); });
    cases++;
  }
for (const loadOverride of [.4, .82, 1, -10, 10, NaN]) check(model.calculate({ people: 100, temperature: 27, loadOverride }));
for (const input of [{}, { people: -1, temperature: 0 }, { people: 10000, temperature: 100 }, { people: NaN, temperature: NaN }]) check(model.calculate(input));
const defaultScenario = model.calculate({ people: 294, temperature: 27 });
near(defaultScenario.baselineLoad, .82); near(defaultScenario.baselineEnergy, 31.6224);
const low = model.calculate({ people: 100, temperature: 27 });
assert.equal(low.modes[1].tubes, 17); assert.equal(low.modes[2].tubes, 16);
const fullHot = model.calculate({ people: 314, temperature: 34 });
fullHot.modes.forEach(mode => near(mode.energy, fullHot.baselineEnergy));
// Reference report is not mutated by the live calculator.
near(reference.modes[0].energy, 1199.7558); near(reference.modes[2].energy, 1087.676478);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length);
for (const match of html.matchAll(/getElementById\('([^']+)'\)/g)) assert.ok(ids.includes(match[1]), 'missing ID: ' + match[1]);
assert.ok(!html.includes('study.modes.map((mode,i)=>`<div class="mode'));
console.log(JSON.stringify({ passed: true, ruleCases: cases, defaultBaseline: defaultScenario.baselineEnergy,
  lowOccupancyModes: low.modes.map(({ name, energy, tubes }) => ({ name, energy, tubes })),
  fullHotModesEqual: true, reportReferenceUnchanged: true }, null, 2));

