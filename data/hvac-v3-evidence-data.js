/* Generated from the V3 replay and step-sensitivity outputs; run build_evidence.cjs to verify. */
window.CarbonHvacV3Evidence = {
  "protocolId": "CARBON-HVAC-FORECAST-GUARD-V3-01",
  "sourceSha256": "b99889edb2d131242242fce4d493c96f2733734f09e5b323fe2a41f983185e6a",
  "stepSourceSha256": "5e8de250f521490922194879809eeda887770bca8eb190ad95fce780e0cc37b2",
  "rows": [
    {
      "date": "2026-06-29",
      "mixingWPerK": 300,
      "directActionChanges": 0,
      "modes": {
        "baseline23": {
          "hvacKwh": 183.79125000000715,
          "occupiedCompliancePct": 53.53276353276353,
          "sampledTemperaturePass": false
        },
        "baseline24": {
          "hvacKwh": 177.67125000000686,
          "occupiedCompliancePct": 59.00997150997151,
          "sampledTemperaturePass": false
        },
        "realtime": {
          "hvacKwh": 165.89025000000544,
          "occupiedCompliancePct": 56.232193732193736,
          "sampledTemperaturePass": false
        },
        "guardedPredictive": {
          "hvacKwh": 165.89025000000544,
          "occupiedCompliancePct": 56.232193732193736,
          "sampledTemperaturePass": false
        }
      },
      "pairs": {
        "baseline24ToGuarded": {
          "rawNominalEnergyDifferenceKwh": 11.781000000001427,
          "maxTerminalTemperatureDifferenceC": 2.3066594886111,
          "eligibleForQualifiedSaving": false,
          "qualifiedSavingPct": null
        },
        "realtimeToGuarded": {
          "rawNominalEnergyDifferenceKwh": 0,
          "maxTerminalTemperatureDifferenceC": 0,
          "eligibleForQualifiedSaving": false,
          "qualifiedSavingPct": null
        }
      }
    },
    {
      "date": "2026-06-30",
      "mixingWPerK": 300,
      "directActionChanges": 2,
      "modes": {
        "baseline23": {
          "hvacKwh": 167.7645000000063,
          "occupiedCompliancePct": 54.576149425287355,
          "sampledTemperaturePass": false
        },
        "baseline24": {
          "hvacKwh": 162.06525000000622,
          "occupiedCompliancePct": 64.03017241379311,
          "sampledTemperaturePass": false
        },
        "realtime": {
          "hvacKwh": 153.19125000000545,
          "occupiedCompliancePct": 71.98994252873563,
          "sampledTemperaturePass": false
        },
        "guardedPredictive": {
          "hvacKwh": 151.584750000006,
          "occupiedCompliancePct": 69.96408045977012,
          "sampledTemperaturePass": false
        }
      },
      "pairs": {
        "baseline24ToGuarded": {
          "rawNominalEnergyDifferenceKwh": 10.480500000000205,
          "maxTerminalTemperatureDifferenceC": 2.9812881198350887,
          "eligibleForQualifiedSaving": false,
          "qualifiedSavingPct": null
        },
        "realtimeToGuarded": {
          "rawNominalEnergyDifferenceKwh": 1.6064999999994427,
          "maxTerminalTemperatureDifferenceC": 1.5628029640826604,
          "eligibleForQualifiedSaving": false,
          "qualifiedSavingPct": null
        }
      }
    },
    {
      "date": "2026-06-29",
      "mixingWPerK": 1000,
      "directActionChanges": 2,
      "modes": {
        "baseline23": {
          "hvacKwh": 180.0427500000072,
          "occupiedCompliancePct": 64.97150997150997,
          "sampledTemperaturePass": false
        },
        "baseline24": {
          "hvacKwh": 174.80250000000638,
          "occupiedCompliancePct": 80.63390313390313,
          "sampledTemperaturePass": false
        },
        "realtime": {
          "hvacKwh": 172.27800000000573,
          "occupiedCompliancePct": 100,
          "sampledTemperaturePass": true
        },
        "guardedPredictive": {
          "hvacKwh": 169.83000000000544,
          "occupiedCompliancePct": 100,
          "sampledTemperaturePass": true
        }
      },
      "pairs": {
        "baseline24ToGuarded": {
          "rawNominalEnergyDifferenceKwh": 4.9725000000009345,
          "maxTerminalTemperatureDifferenceC": 1.373680328542445,
          "eligibleForQualifiedSaving": false,
          "qualifiedSavingPct": null
        },
        "realtimeToGuarded": {
          "rawNominalEnergyDifferenceKwh": 2.4480000000002917,
          "maxTerminalTemperatureDifferenceC": 2.2385513759113422,
          "eligibleForQualifiedSaving": false,
          "qualifiedSavingPct": null
        }
      }
    },
    {
      "date": "2026-06-30",
      "mixingWPerK": 1000,
      "directActionChanges": 1,
      "modes": {
        "baseline23": {
          "hvacKwh": 165.5460000000054,
          "occupiedCompliancePct": 68.44827586206897,
          "sampledTemperaturePass": false
        },
        "baseline24": {
          "hvacKwh": 159.7702500000052,
          "occupiedCompliancePct": 85.17959770114942,
          "sampledTemperaturePass": false
        },
        "realtime": {
          "hvacKwh": 157.2075000000049,
          "occupiedCompliancePct": 100,
          "sampledTemperaturePass": true
        },
        "guardedPredictive": {
          "hvacKwh": 157.475250000005,
          "occupiedCompliancePct": 100,
          "sampledTemperaturePass": true
        }
      },
      "pairs": {
        "baseline24ToGuarded": {
          "rawNominalEnergyDifferenceKwh": 2.295000000000215,
          "maxTerminalTemperatureDifferenceC": 1.5379493121128256,
          "eligibleForQualifiedSaving": false,
          "qualifiedSavingPct": null
        },
        "realtimeToGuarded": {
          "rawNominalEnergyDifferenceKwh": -0.26775000000009186,
          "maxTerminalTemperatureDifferenceC": 0.330296379945171,
          "eligibleForQualifiedSaving": false,
          "qualifiedSavingPct": null
        }
      }
    },
    {
      "date": "2026-06-29",
      "mixingWPerK": 5000,
      "directActionChanges": 1,
      "modes": {
        "baseline23": {
          "hvacKwh": 179.23950000000656,
          "occupiedCompliancePct": 99.8931623931624,
          "sampledTemperaturePass": false
        },
        "baseline24": {
          "hvacKwh": 173.5020000000064,
          "occupiedCompliancePct": 100,
          "sampledTemperaturePass": true
        },
        "realtime": {
          "hvacKwh": 172.3545000000066,
          "occupiedCompliancePct": 100,
          "sampledTemperaturePass": true
        },
        "guardedPredictive": {
          "hvacKwh": 171.01575000000642,
          "occupiedCompliancePct": 100,
          "sampledTemperaturePass": true
        }
      },
      "pairs": {
        "baseline24ToGuarded": {
          "rawNominalEnergyDifferenceKwh": 2.486249999999984,
          "maxTerminalTemperatureDifferenceC": 0.6726985978189965,
          "eligibleForQualifiedSaving": false,
          "qualifiedSavingPct": null
        },
        "realtimeToGuarded": {
          "rawNominalEnergyDifferenceKwh": 1.338750000000175,
          "maxTerminalTemperatureDifferenceC": 0.8412949280484945,
          "eligibleForQualifiedSaving": false,
          "qualifiedSavingPct": null
        }
      }
    },
    {
      "date": "2026-06-30",
      "mixingWPerK": 5000,
      "directActionChanges": 0,
      "modes": {
        "baseline23": {
          "hvacKwh": 164.55150000000646,
          "occupiedCompliancePct": 100,
          "sampledTemperaturePass": true
        },
        "baseline24": {
          "hvacKwh": 159.2347500000047,
          "occupiedCompliancePct": 100,
          "sampledTemperaturePass": true
        },
        "realtime": {
          "hvacKwh": 157.62825000000635,
          "occupiedCompliancePct": 100,
          "sampledTemperaturePass": true
        },
        "guardedPredictive": {
          "hvacKwh": 157.62825000000635,
          "occupiedCompliancePct": 100,
          "sampledTemperaturePass": true
        }
      },
      "pairs": {
        "baseline24ToGuarded": {
          "rawNominalEnergyDifferenceKwh": 1.6064999999983627,
          "maxTerminalTemperatureDifferenceC": 0.018236724720292585,
          "eligibleForQualifiedSaving": true,
          "qualifiedSavingPct": 1.0088878212816708
        },
        "realtimeToGuarded": {
          "rawNominalEnergyDifferenceKwh": 0,
          "maxTerminalTemperatureDifferenceC": 0,
          "eligibleForQualifiedSaving": true,
          "qualifiedSavingPct": 0
        }
      }
    }
  ],
  "stepSensitivity": [
    {
      "stepSeconds": 5,
      "baseline24ToGuarded": {
        "rawNominalEnergyDifferencePct": 0.9452098686310693,
        "maxTerminalTemperatureDifferenceC": 0.05152053403306667,
        "eligibleForQualifiedSaving": false,
        "qualifiedSavingPct": null
      },
      "realtimeToGuarded": {
        "rawNominalEnergyDifferencePct": 0,
        "maxTerminalTemperatureDifferenceC": 0,
        "eligibleForQualifiedSaving": true,
        "qualifiedSavingPct": 0
      }
    },
    {
      "stepSeconds": 15,
      "baseline24ToGuarded": {
        "rawNominalEnergyDifferencePct": 1.0088878212816708,
        "maxTerminalTemperatureDifferenceC": 0.018236724720292585,
        "eligibleForQualifiedSaving": true,
        "qualifiedSavingPct": 1.0088878212816708
      },
      "realtimeToGuarded": {
        "rawNominalEnergyDifferencePct": 0,
        "maxTerminalTemperatureDifferenceC": 0,
        "eligibleForQualifiedSaving": true,
        "qualifiedSavingPct": 0
      }
    },
    {
      "stepSeconds": 60,
      "baseline24ToGuarded": {
        "rawNominalEnergyDifferencePct": 1.0576923076927445,
        "maxTerminalTemperatureDifferenceC": 0.09787750028228004,
        "eligibleForQualifiedSaving": false,
        "qualifiedSavingPct": null
      },
      "realtimeToGuarded": {
        "rawNominalEnergyDifferencePct": 0,
        "maxTerminalTemperatureDifferenceC": 0,
        "eligibleForQualifiedSaving": true,
        "qualifiedSavingPct": 0
      }
    }
  ]
};
