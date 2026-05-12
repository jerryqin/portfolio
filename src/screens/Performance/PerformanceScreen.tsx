import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@realm/react';
import { Colors, Spacing, FontSize, FontWeight, Radius } from '../../theme';
import { DailySnapshot, Transaction, Holding, Portfolio } from '../../database/schema';
import { usePortfolioStore } from '../../store/portfolioStore';
import {
  calcMaxDrawdown,
  calcMaxDrawdownDetail,
  calcVolatility,
  calcSharpe,
  annualizeReturn,
  calcWinRate,
  calcProfitLossRatio,
  calcAvgCost,
  getDefaultRiskFreeRate,
} from '../../utils/finance';

type Period = '1M' | '3M' | '1Y' | 'ALL';

const PERIODS: { key: Period; label: string }[] = [
  { key: '1M', label: '近1月' },
  { key: '3M', label: '近3月' },
  { key: '1Y', label: '近1年' },
  { key: 'ALL', label: '成立以来' },
];

function periodStartDate(period: Period): Date {
  const now = new Date();
  switch (period) {
    case '1M': return new Date(now.setMonth(now.getMonth() - 1));
    case '3M': return new Date(now.setMonth(now.getMonth() - 3));
    case '1Y': return new Date(now.setFullYear(now.getFullYear() - 1));
    case 'ALL': return new Date(0);
  }
}

export default function PerformanceScreen() {
  const [activePeriod, setActivePeriod] = useState<Period>('ALL');
  const { activePortfolioId } = usePortfolioStore();

  const portfolios = useQuery(Portfolio).filtered('isArchived == false');
  const activePortfolio = portfolios.find(p => p._id.toHexString() === activePortfolioId) ?? null;

  const allSnapshots = useQuery(DailySnapshot)
    .filtered(
      activePortfolioId
        ? `portfolioId == oid(${activePortfolioId})`
        : 'FALSEPREDICATE',
    )
    .sorted('date');

  const snapshots = useMemo(() => {
    const cutoff = periodStartDate(activePeriod);
    return Array.from(allSnapshots).filter(s => s.date >= cutoff);
  }, [allSnapshots, activePeriod]);

  const transactions = useQuery(Transaction)
    .filtered(
      activePortfolioId
        ? `portfolioId == oid(${activePortfolioId})`
        : 'FALSEPREDICATE',
    )
    .sorted('date', true);

  const holdings = useQuery(Holding).filtered(
    activePortfolioId
      ? `portfolioId == oid(${activePortfolioId}) AND isDisabled == false`
      : 'FALSEPREDICATE',
  );

  const navSeries = snapshots.map(s => s.navPerUnit);
  const snapDates = snapshots.map(s => s.date);
  const maxDD = calcMaxDrawdown(navSeries);
  const ddDetail = calcMaxDrawdownDetail(navSeries);

  // 波动率需要足够多的快照（至少20个）且跨度足够长（至少60天），否则结果不可靠
  const snapSpanDays = snapDates.length >= 2
    ? (snapDates[snapDates.length - 1].getTime() - snapDates[0].getTime()) / 86400000
    : 0;
  const hasEnoughSnapData = snapshots.length >= 20 && snapSpanDays >= 60;
  const vol = hasEnoughSnapData ? calcVolatility(navSeries, snapDates) : 0;
  const rfr = getDefaultRiskFreeRate('US');

  // 累计收益率：以 initialCapital 为基数直接计算，避免 nav 序列首点不为 1.0 导致虚高
  const totalHoldingsValue = Array.from(holdings).reduce(
    (s, h) => s + h.shares * h.currentPrice, 0,
  );
  const cash = Math.max(activePortfolio?.currentCapital ?? 0, 0);
  const totalAssets = totalHoldingsValue + cash;
  const initialCapital = activePortfolio?.initialCapital ?? 0;
  const totalReturn = initialCapital > 0 ? totalAssets / initialCapital - 1 : 0;

  // 年化收益率：用第一笔交易日期到今天的天数（比 portfolio.createdAt 更准确）
  const now = new Date();
  const inceptionDate = activePortfolio?.createdAt ?? now;
  const txsSortedAsc = useMemo(
    () => Array.from(transactions).sort((a, b) => a.date.getTime() - b.date.getTime()),
    [transactions],
  );
  const firstTxDate = txsSortedAsc.length > 0 ? txsSortedAsc[0].date : inceptionDate;
  const totalDays = Math.max(
    (now.getTime() - firstTxDate.getTime()) / 86400000,
    1,
  );
  const annReturn = annualizeReturn(totalReturn, totalDays);
  const sharpe = calcSharpe(annReturn, vol, rfr);

  // 已实现盈亏：按时序回放全部交易。
  // 关键：以 initialShares/initialAvgCost（CSV导入前的手动录入状态）作为初始成本基础，
  // 避免因 CSV 只包含近期对账单（缺少早期买入记录）导致成本基础为 0，收益虚高。
  const { totalRealized, realizedPnls } = useMemo(() => {
    // 用持仓的 initialShares/initialAvgCost 种入成本基础
    const costBasis = new Map<string, { shares: number; avgCost: number }>();
    for (const h of holdings) {
      if (h.initialShares > 0 && h.initialAvgCost > 0) {
        costBasis.set(h.ticker, { shares: h.initialShares, avgCost: h.initialAvgCost });
      }
    }
    const pnls: number[] = [];
    let total = 0;
    for (const tx of txsSortedAsc) {
      const cb = costBasis.get(tx.ticker) ?? { shares: 0, avgCost: 0 };
      if (tx.type === 'buy') {
        const newShares = cb.shares + tx.shares;
        const newAvgCost = newShares > 0
          ? calcAvgCost(cb.shares, cb.avgCost, tx.shares, tx.price)
          : tx.price;
        costBasis.set(tx.ticker, { shares: newShares, avgCost: newAvgCost });
      } else if (tx.type === 'sell') {
        // 仅当有有效成本基础时才计算盈亏
        if (cb.shares > 0 && cb.avgCost > 0) {
          const realized = (tx.price - cb.avgCost) * tx.shares - tx.commission - tx.tax;
          pnls.push(realized);
          total += realized;
        }
        costBasis.set(tx.ticker, {
          shares: Math.max(0, cb.shares - tx.shares),
          avgCost: cb.avgCost,
        });
      }
    }
    return { totalRealized: total, realizedPnls: pnls };
  }, [txsSortedAsc, holdings]);

  const sellTxs = txsSortedAsc.filter(t => t.type === 'sell');
  const winRate = calcWinRate(realizedPnls);
  const plRatio = calcProfitLossRatio(realizedPnls);

  const unrealizedPnl = Array.from(holdings).reduce(
    (sum, h) => sum + (h.currentPrice - h.avgCost) * h.shares,
    0,
  );

  const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
  const fmtCurrency = (v: number) =>
    v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // 三层分层业绩
  const tranches = [
    { key: 'core', label: '核心仓', color: Colors.coreColor },
    { key: 'satellite', label: '卫星仓', color: Colors.satelliteColor },
    { key: 'trading', label: '交易仓', color: Colors.tradingColor },
  ];

  return (
    <SafeAreaView style={styles.container}>
      {/* 周期选择 */}
      <View style={styles.periodBar}>
        {PERIODS.map(p => (
          <TouchableOpacity
            key={p.key}
            style={[styles.periodItem, activePeriod === p.key && styles.periodItemActive]}
            onPress={() => setActivePeriod(p.key)}>
            <Text style={[styles.periodText, activePeriod === p.key && styles.periodTextActive]}>
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* 收益卡片 */}
        <SectionCard title="收益">
          <StatRow label="累计收益率" value={fmtPct(totalReturn)} positive={totalReturn >= 0} />
          <StatRow label="年化收益率" value={fmtPct(annReturn)} positive={annReturn >= 0} />
          <StatRow label="已实现盈亏" value={fmtCurrency(totalRealized)} positive={totalRealized >= 0} />
          <StatRow label="未实现盈亏" value={fmtCurrency(unrealizedPnl)} positive={unrealizedPnl >= 0} />
        </SectionCard>

        {/* 风险卡片 */}
        <SectionCard title="风险">
          <StatRow label="最大回撤" value={navSeries.length >= 2 ? `-${(maxDD * 100).toFixed(2)}%` : '数据不足'} negative={navSeries.length >= 2} />
          {ddDetail && ddDetail.maxDD > 0 && (
            <View style={styles.ddDetailBox}>
              <View style={styles.ddDetailRow}>
                <Text style={styles.ddDetailLabel}>峰值净值</Text>
                <Text style={styles.ddDetailValue}>{ddDetail.peakNav.toFixed(4)}</Text>
                <Text style={styles.ddDetailDate}>
                  {snapDates[ddDetail.peakIndex]
                    ? snapDates[ddDetail.peakIndex].toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
                    : '--'}
                </Text>
              </View>
              <View style={styles.ddDetailRow}>
                <Text style={styles.ddDetailLabel}>谷值净值</Text>
                <Text style={[styles.ddDetailValue, { color: Colors.loss }]}>{ddDetail.troughNav.toFixed(4)}</Text>
                <Text style={styles.ddDetailDate}>
                  {snapDates[ddDetail.troughIndex]
                    ? snapDates[ddDetail.troughIndex].toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
                    : '--'}
                </Text>
              </View>
              <View style={styles.ddDetailRow}>
                <Text style={styles.ddDetailLabel}>回撤持续</Text>
                <Text style={styles.ddDetailValue}>
                  {snapDates[ddDetail.peakIndex] && snapDates[ddDetail.troughIndex]
                    ? `${Math.round((snapDates[ddDetail.troughIndex].getTime() - snapDates[ddDetail.peakIndex].getTime()) / 86400000)} 天`
                    : '--'}
                </Text>
                <Text style={styles.ddDetailDate} />
              </View>
            </View>
          )}
          <StatRow label="年化波动率" value={hasEnoughSnapData ? `${(vol * 100).toFixed(2)}%` : '数据不足'} />
          <StatRow label="夏普比率" value={hasEnoughSnapData ? sharpe.toFixed(4) : '数据不足'} />
        </SectionCard>

        {/* 交易统计卡片 */}
        <SectionCard title="交易统计">
          <StatRow label="交易次数" value={`${sellTxs.length} 笔`} />
          <StatRow label="胜率" value={realizedPnls.length > 0 ? `${(winRate * 100).toFixed(1)}%` : '--'} />
          <StatRow label="盈亏比" value={plRatio > 0 ? plRatio.toFixed(2) : (realizedPnls.length > 0 ? '无亏损' : '--')} />
        </SectionCard>

        {/* 分层业绩 */}
        <SectionCard title="分层业绩对比">
          {tranches.map(t => {
            const th = Array.from(holdings).filter(h => h.tranche === t.key);
            const val = th.reduce((s, h) => s + h.shares * h.currentPrice, 0);
            const cost = th.reduce((s, h) => s + h.shares * h.avgCost, 0);
            const pnlPct = cost > 0 ? (val - cost) / cost : 0;
            return (
              <View key={t.key} style={styles.trancheRow}>
                <View style={[styles.trancheDot, { backgroundColor: t.color }]} />
                <Text style={styles.trancheLabel}>{t.label}</Text>
                <Text style={[styles.trancheValue, { color: pnlPct >= 0 ? Colors.profit : Colors.loss }]}>
                  {fmtPct(pnlPct)}
                </Text>
              </View>
            );
          })}
        </SectionCard>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={cardStyles.card}>
      <Text style={cardStyles.title}>{title}</Text>
      {children}
    </View>
  );
}

function StatRow({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
}) {
  const color = negative ? Colors.loss : positive ? Colors.profit : Colors.textPrimary;
  return (
    <View style={cardStyles.row}>
      <Text style={cardStyles.label}>{label}</Text>
      <Text style={[cardStyles.value, { color }]}>{value}</Text>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  title: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  label: { fontSize: FontSize.sm, color: Colors.textSecondary },
  value: { fontSize: FontSize.sm, fontWeight: FontWeight.medium },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  periodBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  periodItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  periodItemActive: {
    borderBottomWidth: 2,
    borderBottomColor: Colors.primary,
  },
  periodText: { fontSize: FontSize.sm, color: Colors.textTertiary },
  periodTextActive: { color: Colors.primary, fontWeight: FontWeight.semibold },
  content: { padding: Spacing.md },
  trancheRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  trancheDot: { width: 8, height: 8, borderRadius: 4, marginRight: Spacing.sm },
  trancheLabel: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary },
  trancheValue: { fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  ddDetailBox: {
    backgroundColor: Colors.background,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
    marginTop: 2,
    marginBottom: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  ddDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
  },
  ddDetailLabel: {
    width: 64,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
  ddDetailValue: {
    flex: 1,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    color: Colors.textPrimary,
  },
  ddDetailDate: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
  },
});
