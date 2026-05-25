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
  balanced: [40, 60],
  attacking: [60, 80],
};

// ─── 用户可配置参数 ────────────────────────────────────────

export interface StateConfig {
  observingMax: number;          // 观察态仓位上限，默认 30%
  balancedMin: number;           // 平衡态仓位下限，默认 40%
  balancedMax: number;           // 平衡态仓位上限，默认 60%
  attackingMin: number;          // 进攻态仓位下限，默认 60%
  attackingMax: number;          // 进攻态仓位上限，默认 80%
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
    balancedMin: 40,
    balancedMax: 60,
    attackingMin: 60,
    attackingMax: 80,
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
  currentState: StateType;
  suggestedState: StateType | null;   // null = 维持当前状态
  positionRatioPct: number;           // 当前总仓位 %（0-100）
  highWatermarkNav: number;           // 历史最高净值
  currentDrawdownPct: number;         // 当前相对高点回撤 %（正数）
  upDays: number;                     // 净值连涨天数
  downDays: number;                   // 净值连跌天数
  upgradeReady: boolean;              // 是否满足晋级条件
  downgradeReady: boolean;            // 是否满足降级条件
  blockers: string[];                 // 晋级阻碍原因
  reasons: string[];                  // 降级触发原因
  suggestion: string;                 // 操作建议文案
}

/**
 * 评估组合状态，输出建议动作。
 * @param snapshotNavs  历史快照净值序列（按时间从早到晚）
 * @param currentNavPerUnit  当前实时计算净值（最新值）
 */
export function assessPortfolioState(params: {
  currentState: StateType;
  snapshotNavs: number[];
  currentNavPerUnit: number;
  positionRatioPct: number;
  config: StateConfig;
}): StateAssessment {
  const { currentState, snapshotNavs, currentNavPerUnit, positionRatioPct, config } = params;

  const isInProfit = currentNavPerUnit > 1.0;
  // 历史最高净值包含当前实时值
  const allNavs = [...snapshotNavs, currentNavPerUnit];
  const highWatermarkNav = calcHighWatermarkNav(allNavs);
  const currentDrawdownPct =
    highWatermarkNav > 0
      ? ((highWatermarkNav - currentNavPerUnit) / highWatermarkNav) * 100
      : 0;

  // 连涨/连跌天数基于历史快照（不含当日实时值）
  const { upDays, downDays } = calcConsecutiveNavDays(snapshotNavs);

  let suggestedState: StateType | null = null;
  let upgradeReady = false;
  let downgradeReady = false;
  const blockers: string[] = [];
  const reasons: string[] = [];
  let suggestion = '';

  if (currentState === 'observing') {
    const canUpgrade =
      isInProfit &&
      upDays >= config.upgradeUpDays &&
      positionRatioPct < config.balancedMin;

    if (canUpgrade) {
      upgradeReady = true;
      suggestedState = 'balanced';
      suggestion = `净值已连续 ${upDays} 天上涨，组合盈利，建议逐步加仓至 ${config.balancedMin}%–${config.balancedMax}%，进入平衡态。`;
    } else {
      if (!isInProfit) blockers.push('组合尚未盈利');
      if (upDays < config.upgradeUpDays)
        blockers.push(`净值连涨仅 ${upDays} 天（需 ${config.upgradeUpDays} 天）`);
      suggestion = `维持观察态，等待组合方向确认后再逐步建仓。`;
    }
  } else if (currentState === 'balanced') {
    const canUpgrade =
      upDays >= config.upgradeUpDays &&
      currentDrawdownPct < config.attackingDrawdownPct;

    const shouldDowngrade =
      downDays >= config.downgradeDownDays ||
      currentDrawdownPct > config.portfolioMaxDrawdownPct / 2;

    if (shouldDowngrade) {
      downgradeReady = true;
      suggestedState = 'observing';
      if (downDays >= config.downgradeDownDays)
        reasons.push(`净值连跌 ${downDays} 天`);
      if (currentDrawdownPct > config.portfolioMaxDrawdownPct / 2)
        reasons.push(`回撤 ${currentDrawdownPct.toFixed(2)}% 超过阈值`);
      suggestion = `建议降级至观察态，将总仓位降至 ${config.observingMax}% 以内。`;
    } else if (canUpgrade) {
      upgradeReady = true;
      suggestedState = 'attacking';
      suggestion = `净值连涨 ${upDays} 天，回撤 ${currentDrawdownPct.toFixed(2)}% 控制良好，建议加仓至 ${config.attackingMin}%–${config.attackingMax}%，进入进攻态。`;
    } else {
      if (upDays < config.upgradeUpDays)
        blockers.push(`净值连涨仅 ${upDays} 天（需 ${config.upgradeUpDays} 天）`);
      if (currentDrawdownPct >= config.attackingDrawdownPct)
        blockers.push(`回撤 ${currentDrawdownPct.toFixed(2)}% 超过进攻阈值`);
      suggestion = `维持平衡态，关注核心持仓走势。`;
    }
  } else {
    // attacking
    const shouldDowngrade =
      currentDrawdownPct >= config.attackingDrawdownPct ||
      downDays >= config.downgradeDownDays;

    if (shouldDowngrade) {
      downgradeReady = true;
      suggestedState = 'balanced';
      if (currentDrawdownPct >= config.attackingDrawdownPct)
        reasons.push(`净值从高点回撤 ${currentDrawdownPct.toFixed(2)}%（阈值 ${config.attackingDrawdownPct}%）`);
      if (downDays >= config.downgradeDownDays)
        reasons.push(`净值连跌 ${downDays} 天`);
      suggestion = `建议降级至平衡态，将总仓位降至 ${config.balancedMin}%–${config.balancedMax}%。`;
    } else {
      suggestion = `维持进攻态，跟踪核心持仓是否持续走强。`;
    }
  }

  return {
    currentState,
    suggestedState,
    positionRatioPct,
    highWatermarkNav,
    currentDrawdownPct,
    upDays,
    downDays,
    upgradeReady,
    downgradeReady,
    blockers,
    reasons,
    suggestion,
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
