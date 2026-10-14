'use strict';
window.CarbonJointForecastActionEvidence = {
  id: 'CARBON-JOINT-FORECAST-ACTION-01',
  version: '20261014-forecast-action-local',
  decisionPointsPerCase: 192,
  meaning: 'Same-state count compares forecast and persistence commands inside the predictive replay; cross-mode count compares two separate daily trajectories and is not a forecast-only energy attribution.',
  cases: [
    {date:'2026-06-29',mixingWPerK:300,replaySource:'2026-06-29_mix300_joint.json',replaySha256:'89a0e7025b00891f3597542a63c2a9de02434a6134faee14b22a6be3fdaf64e7',forecastSelectedCount:76,sameStateCommandChanges:2,crossModeCommandDifferences:44},
    {date:'2026-06-29',mixingWPerK:1000,replaySource:'2026-06-29_mix1000_joint.json',replaySha256:'9ce6358b8f45be193c807aeb0cdedaa52b8e46c6d0eb68ae83a761c909d6829b',forecastSelectedCount:79,sameStateCommandChanges:5,crossModeCommandDifferences:127},
    {date:'2026-06-29',mixingWPerK:5000,replaySource:'2026-06-29_mix5000_joint.json',replaySha256:'1633d35ca0421c92954fda7069d347d137d2049fd9438ed6f5c52199e3a6f0d8',forecastSelectedCount:79,sameStateCommandChanges:1,crossModeCommandDifferences:11},
    {date:'2026-06-30',mixingWPerK:300,replaySource:'2026-06-30_mix300_joint.json',replaySha256:'c48b505ca18694e36100dcd2c6c9328185afa1efa66b91142e1ece4475c29c84',forecastSelectedCount:96,sameStateCommandChanges:1,crossModeCommandDifferences:10},
    {date:'2026-06-30',mixingWPerK:1000,replaySource:'2026-06-30_mix1000_joint.json',replaySha256:'5c125e39080f0c9d4fe3baaf349fbd5e4560d46efa52638ac8656c9b36fdf25d',forecastSelectedCount:98,sameStateCommandChanges:0,crossModeCommandDifferences:0},
    {date:'2026-06-30',mixingWPerK:5000,replaySource:'2026-06-30_mix5000_joint.json',replaySha256:'8f85ff1ca268c5d8cd320af94fbc00883a2206a2e49a56254a84e7c87debb14f',forecastSelectedCount:99,sameStateCommandChanges:0,crossModeCommandDifferences:0}
  ]
};
