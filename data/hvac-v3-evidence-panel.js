(() => {
  'use strict';
  const data = window.CarbonHvacV3Evidence;
  const date = document.getElementById('hvacEvidenceDate');
  const mixing = document.getElementById('hvacEvidenceMixing');
  const cards = document.getElementById('hvacEvidenceCards');
  const verdict = document.getElementById('hvacEvidenceVerdict');
  const pairs = document.getElementById('hvacEvidencePairs');
  if (!data || !date || !mixing || !cards || !verdict || !pairs) return;

  const modeList = [
    ['baseline24', '日常基准 · 24℃设备设温', 'baseline'],
    ['realtime', '实时感知 · 当前代理', 'realtime'],
    ['guardedPredictive', '预测协同', 'predictive']
  ];
  const format = (number, digits = 2) => Number(number).toFixed(digits);
  function render() {
    const row = data.rows.find(item => item.date === date.value && item.mixingWPerK === Number(mixing.value));
    if (!row) { verdict.textContent = '未找到此回放组合。'; return; }
    const maxEnergy = Math.max(...modeList.map(([key]) => row.modes[key].hvacKwh));
    cards.innerHTML = modeList.map(([key, label, className]) => {
      const mode = row.modes[key];
      return `<article class="hvac-evidence-card ${className}"><h3>${label}</h3><strong class="hvac-evidence-energy">${format(mode.hvacKwh)} <small>kWh · 名义空调电量</small></strong><div class="hvac-evidence-meter" aria-hidden="true"><i style="width:${format(100 * mode.hvacKwh / maxEnergy, 1)}%"></i></div><dl><dt>有人区模型室温达标</dt><dd class="${mode.sampledTemperaturePass ? '' : 'fail'}">${format(mode.occupiedCompliancePct, 1)}%</dd></dl></article>`;
    }).join('');
    const basePair = row.pairs.baseline24ToGuarded;
    const forecastPair = row.pairs.realtimeToGuarded;
    const allPass = modeList.every(([key]) => row.modes[key].sampledTemperaturePass);
    verdict.textContent = allPass
      ? '三策略模型温度达标；预测节电仍未通过跨步长、跨混合假设核查。'
      : '有人区模型温度未全部达标，名义用电差不能称为合格节电。';
    const actionNote = document.getElementById('hvacEvidenceActionNote');
    if (actionNote) actionNote.textContent = `本组合有${row.directActionChanges}次当前指令由预测直接改变；动作变化只说明预测参与控制，不等于形成节电。`;
    const pairRows = [
      ['24℃基准 → 预测协同', basePair],
      ['实时感知 → 预测协同', forecastPair]
    ];
    pairs.innerHTML = pairRows.map(([label, pair]) => {
      const qualification = pair.eligibleForQualifiedSaving
        ? `${format(pair.qualifiedSavingPct)}%（仅此15秒回放；仍须看步长与混合敏感性）`
        : '不可计算合格节电率';
      return `<div class="hvac-evidence-pair"><b>${label}</b><p>名义电量差：${format(pair.rawNominalEnergyDifferenceKwh, 3)} kWh（前者减后者）；四区末温最大差：${format(pair.maxTerminalTemperatureDifferenceC, 3)}℃；${qualification}。</p></div>`;
    }).join('');
  }
  date.addEventListener('change', render);
  mixing.addEventListener('change', render);
  render();
})();
