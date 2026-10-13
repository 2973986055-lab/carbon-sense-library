'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
for (const file of ['building-inputs.js', 'thermal-model.js', 'environment-dataset.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'data', file), 'utf8'), context);
}
const model = vm.runInContext('thermalModel', context);
const inputs = vm.runInContext('buildingInputs', context);
const data = vm.runInContext('environmentDataset', context);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const record = data.records.find(r => r.date === '2026-06-29' && r.time === '16:00');

// Zero reservations must not implicitly grant permission to switch equipment off.
const vacantProxy = model.compare(record, {people: 0});
assert.equal(vacantProxy.baseline.enabledAcUnits, 2);
assert.equal(vacantProxy.baseline.tubes, 42);
assert.ok(vacantProxy.baseline.energyKwh > 0);
assert.ok(vacantProxy.baseline.flags.some(flag => flag.includes('不作为')));
const nightRecord = data.records.find(r => r.floorReservationProxy === 0);
assert.equal(model.compare(nightRecord).baseline.enabledAcUnits, 2);

// Explicit closure has zero energy only when both AC and normal lights are off.
const closed = model.compare(record, {people: 0, acRunning: false, baselineTubes: 0, optimizedTubes: 0});
for (const mode of closed.modes) {
  near(mode.energyKwh, 0);
  assert.equal(mode.savingPct, null);
  assert.equal(mode.humidityEstimatePct, null);
}
const lightsOnly = model.calculate(record, {people: 0, acRunning: false, tubes: 42});
near(lightsOnly.hvacKwh, 0);
near(lightsOnly.energyKwh, .756 * .5);

// Identical strategies have zero savings for every baseline in the reported range.
for (const baselineSetpointC of [23, 23.5, 24]) {
  for (const sample of data.records) {
    const same = model.compare(sample, {baselineSetpointC});
    for (const mode of same.modes) near(mode.savedKwh, 0);
  }
  const paired = model.compareSensitivity(record, {baselineSetpointC});
  near(paired.savedKwhRange[0], 0);
  near(paired.savedKwhRange[1], 0);
}
const warmer = model.compare(record, {people: 250, baselineSetpointC: 23, optimizedSetpointC: 24});
assert.ok(warmer.modes[1].savedKwh > 0);
near(warmer.modes[1].energyKwh, warmer.modes[2].energyKwh);
const colder = model.compare(record, {people: 250, baselineSetpointC: 24, optimizedSetpointC: 23});
assert.ok(colder.modes[1].savedKwh < 0);

// Sensitivity differences must be paired under matching weather and assumptions.
const input = {people: 250, baselineSetpointC: 23, optimizedSetpointC: 24, optimizedTubes: 30};
const differences = [];
for (const heightM of [3.3, 4]) for (const ach of [.3, 1]) for (const initialRhPct of [45, 65]) for (const shr of [.65, .85]) {
  const settings = {...input, heightM, ach, initialRhPct, shr};
  const baseline = model.calculate(record, {...settings, setpointC: 23, tubes: 42});
  const strategy = model.calculate(record, {...settings, setpointC: 24, tubes: 30});
  differences.push(baseline.energyKwh - strategy.energyKwh);
}
const range = model.compareSensitivity(record, input);
near(range.savedKwhRange[0], Math.min(...differences));
near(range.savedKwhRange[1], Math.max(...differences));
const extreme = model.compareSensitivity({...record, outdoorTemperatureC: 45, southVerticalIrradianceWm2: 2000}, input);
assert.ok(extreme.capacityInsufficientScenarios > 0);

// User confirmation changes provenance; it does not create a second nameplate photo.
assert.equal(inputs.equipment.hvac.sameSpecificationConfirmed, true);
assert.equal(inputs.equipment.hvac.photographedLabels, 1);
assert.equal(inputs.equipment.lighting.individuallySwitchable, true);
assert.equal(JSON.stringify(data.building), JSON.stringify(inputs));
assert.ok(!data.missingInputs.includes('ac_second_unit_label'));
assert.equal(inputs.availableData.floorAttendanceMeasured, false);
assert.equal(inputs.availableData.indoorTemperatureHumidityMeasured, false);
assert.equal(inputs.availableData.historicalElectricityObtainable, false);
console.log('Operating baseline: reservation-zero isolation, explicit closure, 23–24C comparison, paired sensitivity and provenance passed.');
