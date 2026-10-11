'use strict';

// User-reported approximate dimensions are distinct from modelling assumptions.
const buildingInputs = {
  revision: '2026-10-11',
  geometry: {
    lengthM: 27, widthM: 14, floorAreaM2: 378,
    ceilingHeightM: null,
    windowOrientation: 'south', windowAzimuthDeg: 180,
    windowGroups: 8, windowWidthPerGroupM: 1.8, windowHeightM: 2.4,
    windowTotalWidthM: 14.4, windowAreaM2: 34.56, windowSillHeightM: 0.9,
    previousFacadeSpanM: 24,
    windowClarification: '用户确认8组窗总宽约14.4m；24m不作为玻璃净宽计算',
    northBoundary: '走廊内墙，无窗', eastWestWindows: '用户描述几乎没有外窗',
    doorsWindowsClosed: true, heavyCurtainsAvailable: true,
    daytimeCurtains: 'open', ventilationEquipment: null,
    source: '用户现场描述，尺寸均为约数，非实测建筑图纸'
  },
  operation: {
    enabledAcUnits: 2, baselineSetpointC: 24, baselineLightsOn: 42,
    acStartRule: '早上有人到场后开启', acStopRule: '晚上无人后关闭',
    exactStartTime: null, exactStopTime: null,
    actualAcRuntimeHours: null, source: '用户描述通常运行方式，非历史运行日志'
  },
  availableData: {
    floorAttendanceMeasured: false, indoorTemperatureHumidityMeasured: false,
    historicalElectricityObtainable: false,
    reservationDuplicates: '用户认为可能没有去重，未确认；不擅自去重',
    lampSeatMapVerified: false, illuminanceMeasured: false
  },
  safetyContext: {
    reportedStructuralColumns: 2, reportedSafetyExits: 3,
    extinguishers: '用户描述多组，位置未实测', emergencyLightingPresent: true,
    exactPositionsVerified: false,
    excludedFromEnergyOptimisation: ['应急照明', '安全出口', '疏散通道'],
    note: '只记录现场描述，不据此绘制合规疏散路线或做消防验收判断'
  },
  // Editable scenario defaults, NOT observations or trained coefficients.
  assumptions: {
    ceilingHeightM: 3.5, heightSensitivityM: [3.3, 4.0],
    infiltrationAch: 0.5, infiltrationSensitivityAch: [0.3, 1.0],
    glassUValueWm2K: 5.7, opaqueUValueWm2K: 1.5,
    solarHeatGainCoefficient: 0.7, curtainSolarMultiplierClosed: 0.35,
    initiallyAssumedRhPct: 55, initialRhSensitivityPct: [45, 65],
    peopleTotalHeatW: 130, peopleSensibleFraction: 0.6,
    coilSensibleHeatRatio: 0.75, coilShrSensitivity: [0.65, 0.85],
    coilApparatusDewPointC: 12, genericCyclingLossCoefficient: 0.15,
    groundAlbedo: 0.2,
    boundarySimplification: '仅计明确的南外墙与玻璃；未确认的其他围护边界暂视为与目标室温同温，不计传热',
    heightBasis: '净高未知，暂估3.5m；窗上沿约3.3m，另比较3.3—4.0m情景，不是测量置信区间',
    scope: '未校准的准稳态热负荷与短时湿量平衡；不含启动降温蓄热、精细材料传热或真实设备性能曲线',
    sources: [
      'https://energyplus.net/assets/nrel_custom/pdfs/pdfs_v24.1.0/EngineeringReference.pdf',
      'https://energyplus.net/assets/nrel_custom/pdfs/pdfs_v23.2.0/InputOutputReference.pdf'
    ]
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = buildingInputs;
