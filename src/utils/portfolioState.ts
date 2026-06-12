// ─── 组合状态系统 V2.0 工具函数 ──────────────────────────────
// 三种状态：观察态 / 平衡态 / 进攻态
// 四类信号：有效突破 / 回踩不破 / 冲高回落 / 跌破关键位

export type StateType = 'observing' | 'balanced' | 'attacking';
export type HoldingSignal = 'none' | 'breakout' | 'pullbackHold' | 'spikeReversal' | 'breakdown';

export const SIGNAL_LABELS: Record<HoldingSignal, string> = {
  none: '无信号',
  breakout: '有效突破',
  pullbackHold: '回踩不破',
  spikeReversal: '冲高回落',
  breakdown: '跌破关键位',
};

export const SIGNAL_SHORT_LABELS: Record<HoldingSignal, string> = {
  none: '无',
  breakout: '突破',
  pullbackHold: '回踩',
  spikeReversal: '冲高',
  breakdown: '跌破',
};

export const STATE_LABELS: Record<StateType, string> = {
  observing: '观察态',
  balanced: '平衡态',
  attacking: '进攻态',
};

// 状态对应颜色：观察态-灰蓝 / 平衡态-琥珀 / 进攻态-红
export const STATE_COLORS: Record<StateType, string> = {
  observing: '#64748B',
  balanced: '#D97706',
  attacking: '#DC2626',
};

// 信号对应颜色
export const SIGNAL_COLORS: Record<HoldingSignal, string> = {
  none: '#64748B',
  breakout: '#16A34A',   // 绿 - 进攻
  pullbackHold: '#2563EB', // 蓝 - 回踩买入
  spikeReversal: '#EA580C', // 橙 - 警惕
  breakdown: '#DC2626',  // 红 - 危险
};

// 每种状态对应的建议仓位区间 [min%, max%]
export const STATE_RANGE: Record<StateType, [number, number]> = {
  observing: [0, 30],
  balanced: [30, 60],
  attacking: [60, 90],
};

// ─── 用户可配置参数 ────────────────────────────────────────

export interface StateConfig {
  observingMax: number;          // 观察态仓位上限，默认 30%
  balancedMin: number;           // 平衡态仓位下限，默认 30%
  balancedMax: number;           // 平衡态仓位上限，默认 60%
  attackingMin: number;          // 进攻态仓位下限，默认 60%
  attackingMax: number;          // 进攻态仓位上限，默认 90%
  upgradeUpDays: number;         // 晋级所需净值连涨天数，默认 3
  downgradeDownDays: number;     // 降级所需净值连跌天数，默认 3
  attackingDrawdownPct: number;  // 进攻态最大允许回撤 %，默认 4
  portfolioMaxDrawdownPct: number; // 组合最大允许回撤 %，默认 20
  breakoutAddMin: number;        // 有效突破最小加仓比例，默认 0.20 (1/5)
  breakoutAddMax: number;        // 有效突破最大加仓比例，默认 0.25 (1/4)
  pullbackAddMin: number;        // 回踩不破最小加仓比例，默认 0.333 (1/3)
  pullbackAddMax: number;        // 回踩不破最大加仓比例，默认 0.50 (1/2)
  spikeReduceRatio: number;      // 冲高回落减仓比例，默认 0.333 (1/3)
  breakdownReduceRatio: number;  // 跌破关键位减仓比例，默认 0.50 (1/2)
}

export function defaultStateConfig(): StateConfig {
  return {
    observingMax: 30,
    balancedMin: 30,
    balancedMax: 60,
    attackingMin: 60,
    attackingMax: 90,
    upgradeUpDays: 3,
    downgradeDownDays: 3,
    attackingDrawdownPct: 4,
    portfolioMaxDrawdownPct: 20,
    breakoutAddMin: 0.20,
    breakoutAddMax: 0.25,
    pullbackAddMin: 1 / 3,
    pullbackAddMax: 0.50,
    spikeReduceRatio: 1 / 3,
    breakdownReduceRatio: 0.50,
  };
}

export function parseStateConfig(json: string): StateConfig {
  try {
    const parsed = JSON.parse(json);
    return { ...defaultStateConfig(), ...parsed };
  } catch {
    return defaultStateConfig();
  }
}

// ─── 净值序列计算 ──────────────────────────────────────────

/** 从净值序列中计算历史最高净值（含当前值） */
export function calcHighWatermarkNav(navSeries: number[]): number {
  if (navSeries.length === 0) return 1;
  return Math.max(...navSeries);
}

/** 计算净值序列末尾的连涨/连跌天数（序列按时间从早到晚排列） */
export function calcConsecutiveNavDays(navSeries: number[]): {
  upDays: number;
  downDays: number;
} {
  if (navSeries.length < 2) return { upDays: 0, downDays: 0 };
  let upDays = 0;
  let downDays = 0;
  for (let i = navSeries.length - 1; i > 0; i--) {
    if (navSeries[i] > navSeries[i - 1]) upDays++;
    else break;
  }
  for (let i = navSeries.length - 1; i > 0; i--) {
    if (navSeries[i] < navSeries[i - 1]) downDays++;
    else break;
  }
  return { upDays, downDays };
}

// ─── 组合状态评估 ──────────────────────────────────────────

export interface StateAssessment {
  currentState: StateType;        // 当前状态：仅由仓位比例决定
  recommendedState: StateType;    // 建议状态：综合回撤、连涨等指标
  recommendedReasons: string[];   // 建议依据
  suggestion: string;             // 操作建议文案
  positionRatioPct: number;
  highWatermarkNav: number;
  currentDrawdownPct: number;
  upDays: number;
  downDays: number;
}

/**
 * 纯基于量化指标计算「客观建议状态」，完全不受用户已记录的 currentState 影响。
 * 这样无论用户把按钮切到哪里，这个结果都保持稳定。
 */
function computeObjectiveState(params: {
  positionRatioPct: number;
  currentDrawdownPct: number;
  upDays: number;
  isInProfit: boolean;
  config: StateConfig;
}): { state: StateType; reasons: string[] } {
  const { positionRatioPct, currentDrawdownPct, upDays, isInProfit, config } = params;
  const reasons: string[] = [];

  // ① 回撤触及最大阈值 → 必须观察态
  if (currentDrawdownPct >= config.portfolioMaxDrawdownPct) {
    reasons.push(`回撤 ${currentDrawdownPct.toFixed(1)}% 达到最大阈值 ${config.portfolioMaxDrawdownPct}%，须大幅减仓`);
    return { state: 'observing', reasons };
  }

  // ② 回撤超过进攻阈值 → 最多平衡态
  if (currentDrawdownPct >= config.attackingDrawdownPct) {
    reasons.push(`回撤 ${currentDrawdownPct.toFixed(1)}% 超过进攻态阈值 ${config.attackingDrawdownPct}%`);
    if (positionRatioPct > config.balancedMax) {
      reasons.push(`仓位 ${positionRatioPct.toFixed(1)}% 超出平衡态上限 ${config.balancedMax}%，建议减仓至 ${config.balancedMin}%–${config.balancedMax}%`);
    }
    return { state: 'balanced', reasons };
  }

  // ③ 仓位超出进攻上限（仓位偏重但回撤尚可）→ 平衡态
  if (positionRatioPct > config.attackingMax) {
    reasons.push(`仓位 ${positionRatioPct.toFixed(1)}% 超出进攻态上限 ${config.attackingMax}%，建议小幅减仓至 ${config.attackingMin}%–${config.attackingMax}%`);
    return { state: 'balanced', reasons };
  }

  // ④ 具备进攻条件：仓位合理 + 回撤小 + 连涨 + 盈利
  if (
    positionRatioPct >= config.attackingMin &&
    upDays >= config.upgradeUpDays &&
    isInProfit
  ) {
    reasons.push(`仓位 ${positionRatioPct.toFixed(1)}% 在进攻区间，净值连涨 ${upDays} 天，组合盈利`);
    return { state: 'attacking', reasons };
  }

  // ⑤ 仓位极低 + 亏损 → 观察态
  if (positionRatioPct <= config.observingMax && !isInProfit) {
    reasons.push(`组合亏损且仓位 ${positionRatioPct.toFixed(1)}% 偏低，等待方向确认`);
    return { state: 'observing', reasons };
  }

  // ⑥ 默认：平衡态
  reasons.push(`仓位 ${positionRatioPct.toFixed(1)}% 在合理范围，回撤 ${currentDrawdownPct.toFixed(1)}% 可控`);
  return { state: 'balanced', reasons };
}

/**
 * 仅根据仓位比例判断当前所处状态（最直接的客观事实）。
 */
function stateFromPosition(positionRatioPct: number, config: StateConfig): StateType {
  if (positionRatioPct <= config.observingMax) return 'observing';
  if (positionRatioPct <= config.balancedMax)  return 'balanced';
  return 'attacking';
}

/**
 * 评估组合状态。
 * - currentState：仅由当前仓位比例决定（最直观的客观事实）
 * - recommendedState：综合回撤、连涨天数、盈亏等指标给出操作建议
 */
export function assessPortfolioState(params: {
  snapshotNavs: number[];
  currentNavPerUnit: number;
  positionRatioPct: number;
  config: StateConfig;
}): StateAssessment {
  const { snapshotNavs, currentNavPerUnit, positionRatioPct, config } = params;

  const isInProfit = currentNavPerUnit > 1.0;
  const allNavs = [...snapshotNavs, currentNavPerUnit];
  const highWatermarkNav = calcHighWatermarkNav(allNavs);
  const currentDrawdownPct =
    highWatermarkNav > 0
      ? ((highWatermarkNav - currentNavPerUnit) / highWatermarkNav) * 100
      : 0;

  const { upDays, downDays } = calcConsecutiveNavDays(snapshotNavs);

  // 当前状态：仅看仓位
  const currentState = stateFromPosition(positionRatioPct, config);

  // 建议状态：综合所有指标
  const { state: recommendedState, reasons: recommendedReasons } = computeObjectiveState({
    positionRatioPct,
    currentDrawdownPct,
    upDays,
    isInProfit,
    config,
  });

  // 建议文案
  const stateOrder: Record<StateType, number> = { observing: 0, balanced: 1, attacking: 2 };
  let suggestion: string;
  if (stateOrder[recommendedState] < stateOrder[currentState]) {
    suggestion = `建议降至${STATE_LABELS[recommendedState]}：${recommendedReasons[0] ?? ''}。`;
  } else if (stateOrder[recommendedState] > stateOrder[currentState]) {
    suggestion = `可升至${STATE_LABELS[recommendedState]}：${recommendedReasons[0] ?? ''}。`;
  } else {
    suggestion = `当前状态与建议匹配：${recommendedReasons[0] ?? '继续保持'}。`;
  }

  return {
    currentState,
    recommendedState,
    recommendedReasons,
    suggestion,
    positionRatioPct,
    highWatermarkNav,
    currentDrawdownPct,
    upDays,
    downDays,
  };
}

// ─── 个股操作建议 ──────────────────────────────────────────

export interface HoldingAdvice {
  action: 'add' | 'reduce';
  changeMin: number;        // 建议变动仓位下限（百分点，正数）
  changeMax: number;        // 建议变动仓位上限（百分点，正数）
  newWeightMin: number;     // 操作后最小仓位 %
  newWeightMax: number;     // 操作后最大仓位 %
  label: string;            // 操作简称
  reason: string;           // 操作理由
}

/**
 * 根据个股信号生成加减仓建议。
 * @param currentWeightPct  当前该股实际仓位（占总资产 %）
 * @param positionRatioPct  组合当前总仓位 %（用于计算仓位空间）
 */
export function generateHoldingAdvice(params: {
  signal: HoldingSignal;
  currentWeightPct: number;
  positionRatioPct: number;
  portfolioState: StateType;
  config: StateConfig;
}): HoldingAdvice | null {
  const { signal, currentWeightPct, positionRatioPct, portfolioState, config } = params;
  if (signal === 'none') return null;

  const stateMax =
    portfolioState === 'observing'
      ? config.observingMax
      : portfolioState === 'balanced'
      ? config.balancedMax
      : config.attackingMax;
  const headroom = Math.max(0, stateMax - positionRatioPct);

  if (signal === 'breakout') {
    const rawMin = currentWeightPct * config.breakoutAddMin;
    const rawMax = currentWeightPct * config.breakoutAddMax;
    const changeMin = parseFloat(Math.min(rawMin, headroom).toFixed(2));
    const changeMax = parseFloat(Math.min(rawMax, headroom).toFixed(2));
    return {
      action: 'add',
      changeMin,
      changeMax,
      newWeightMin: parseFloat((currentWeightPct + changeMin).toFixed(2)),
      newWeightMax: parseFloat((currentWeightPct + changeMax).toFixed(2)),
      label: '有效突破 · 加仓',
      reason: `突破关键压力位，放量确认，建议加仓现有仓位的 1/5–1/4。`,
    };
  }

  if (signal === 'pullbackHold') {
    const rawMin = currentWeightPct * config.pullbackAddMin;
    const rawMax = currentWeightPct * config.pullbackAddMax;
    const changeMin = parseFloat(Math.min(rawMin, headroom).toFixed(2));
    const changeMax = parseFloat(Math.min(rawMax, headroom).toFixed(2));
    return {
      action: 'add',
      changeMin,
      changeMax,
      newWeightMin: parseFloat((currentWeightPct + changeMin).toFixed(2)),
      newWeightMax: parseFloat((currentWeightPct + changeMax).toFixed(2)),
      label: '回踩不破 · 加仓',
      reason: `回踩关键支撑，止跌信号出现，核心逻辑未破坏，建议加仓现有仓位的 1/3–1/2。`,
    };
  }

  if (signal === 'spikeReversal') {
    const change = parseFloat((currentWeightPct * config.spikeReduceRatio).toFixed(2));
    return {
      action: 'reduce',
      changeMin: change,
      changeMax: change,
      newWeightMin: parseFloat((currentWeightPct - change).toFixed(2)),
      newWeightMax: parseFloat((currentWeightPct - change).toFixed(2)),
      label: '冲高回落 · 减仓',
      reason: `高位分歧明显，先保护利润，建议减仓现有仓位的 1/3。`,
    };
  }

  if (signal === 'breakdown') {
    const change = parseFloat((currentWeightPct * config.breakdownReduceRatio).toFixed(2));
    return {
      action: 'reduce',
      changeMin: change,
      changeMax: change,
      newWeightMin: parseFloat((currentWeightPct - change).toFixed(2)),
      newWeightMax: parseFloat((currentWeightPct - change).toFixed(2)),
      label: '跌破关键位 · 减仓',
      reason: `趋势结构被破坏，及时控制风险，建议减仓现有仓位的 1/2。`,
    };
  }

  return null;
}
