/**
 * TWRR 时间加权收益率计算工具
 * 核心思路：将每次现金流前后分成子期，各子期独立计算收益，最终连乘
 */

export interface PeriodPoint {
  date: Date;
  beginValue: number;   // 子期期初市值
  endValue: number;     // 子期期末市值
  cashFlow: number;     // 期内现金流（期末进行，买入为正）
}

/**
 * 计算 TWRR 累计收益率
 * @returns 0.15 = 15%
 */
export function calcTWRR(periods: PeriodPoint[]): number {
  if (periods.length === 0) return 0;
  let product = 1;
  for (const p of periods) {
    if (p.beginValue === 0) continue;
    const subReturn = (p.endValue - p.cashFlow) / p.beginValue;
    product *= subReturn;
  }
  return product - 1;
}

/**
 * 计算年化收益率
 */
export function annualizeReturn(totalReturn: number, days: number): number {
  if (days <= 0) return 0;
  const years = days / 365;
  return Math.pow(1 + totalReturn, 1 / years) - 1;
}

/**
 * 计算最大回撤
 * @param navSeries 单位净值序列，按时间升序
 */
export function calcMaxDrawdown(navSeries: number[]): number {
  if (navSeries.length < 2) return 0;
  let peak = navSeries[0];
  let maxDD = 0;
  for (const nav of navSeries) {
    if (nav > peak) peak = nav;
    const dd = (peak - nav) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

/**
 * 计算年化波动率（基于日收益率标准差）
 * @param navSeries 净值序列，按时间升序
 * @param dates 对应的日期序列；提供时将多日跨度的收益率归一化为日均收益率，避免稀疏快照虚高波动率
 */
export function calcVolatility(navSeries: number[], dates?: Date[]): number {
  if (navSeries.length < 2) return 0;
  const dailyReturns: number[] = [];
  for (let i = 1; i < navSeries.length; i++) {
    const periodReturn = (navSeries[i] - navSeries[i - 1]) / navSeries[i - 1];
    if (dates && dates[i] && dates[i - 1]) {
      // 按实际日历天数将区间收益归一化为日均收益（线性近似）
      const dayGap = Math.max(1, (dates[i].getTime() - dates[i - 1].getTime()) / 86400000);
      dailyReturns.push(periodReturn / dayGap);
    } else {
      dailyReturns.push(periodReturn);
    }
  }
  if (dailyReturns.length < 2) return 0;
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance =
    dailyReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) /
    (dailyReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252); // 年化
}

/**
 * 计算夏普比率
 * @param annualReturn 年化收益率
 * @param annualVolatility 年化波动率
 * @param riskFreeRate 无风险收益率（年化），如 0.053 = 5.3%
 */
export function calcSharpe(
  annualReturn: number,
  annualVolatility: number,
  riskFreeRate: number,
): number {
  if (annualVolatility === 0) return 0;
  return (annualReturn - riskFreeRate) / annualVolatility;
}

/**
 * 计算交易胜率
 */
export function calcWinRate(realizedPnls: number[]): number {
  if (realizedPnls.length === 0) return 0;
  const wins = realizedPnls.filter(p => p > 0).length;
  return wins / realizedPnls.length;
}

/**
 * 计算盈亏比
 */
export function calcProfitLossRatio(realizedPnls: number[]): number {
  const wins = realizedPnls.filter(p => p > 0);
  const losses = realizedPnls.filter(p => p < 0);
  if (losses.length === 0 || wins.length === 0) return 0;
  const avgWin = wins.reduce((a, b) => a + b, 0) / wins.length;
  const avgLoss = Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length);
  return avgLoss === 0 ? 0 : avgWin / avgLoss;
}

/**
 * 加权平均成本计算（FIFO买入方向）
 * @param prevShares 当前持股数
 * @param prevAvgCost 当前平均成本
 * @param newShares 本次买入数量
 * @param newPrice 本次买入价格
 */
export function calcAvgCost(
  prevShares: number,
  prevAvgCost: number,
  newShares: number,
  newPrice: number,
): number {
  const totalShares = prevShares + newShares;
  if (totalShares === 0) return 0;
  return (prevShares * prevAvgCost + newShares * newPrice) / totalShares;
}

/**
 * 按市场获取默认无风险利率
 */
export function getDefaultRiskFreeRate(market: string): number {
  switch (market) {
    case 'US':
      return 0.053; // 联邦基金利率（需定期更新）
    case 'CN':
      return 0.025; // 10年期国债收益率
    case 'HK':
      return 0.048; // 港元隔夜利率
    default:
      return 0.04;
  }
}
