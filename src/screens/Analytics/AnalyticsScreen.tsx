import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@realm/react';
import { Spacing, FontSize, FontWeight, Radius, ThemeColors } from '../../theme';
import { useColors } from '../../theme/useColors';
import { Portfolio, Holding, DailySnapshot, Transaction } from '../../database/schema';
import { usePortfolioStore } from '../../store/portfolioStore';
import {
  calcMaxDrawdown,
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
    case '1M': return new Date(new Date().setMonth(now.getMonth() - 1));
    case '3M': return new Date(new Date().setMonth(now.getMonth() - 3));
    case '1Y': return new Date(new Date().setFullYear(now.getFullYear() - 1));
    case 'ALL': return new Date(0);
  }
}

export default function AnalyticsScreen() {
  const Colors = useColors();
  const [activePeriod, setActivePeriod] = useState<Period>('ALL');
  const { activePortfolioId, refreshPrices, isPriceLoading } = usePortfolioStore();

  // ── 数据查询 ──
  const portfolios = useQuery(Portfolio).filtered('isArchived == false');
  const activePortfolio = portfolios.find(p => p._id.toHexString() === activePortfolioId) ?? portfolios[0] ?? null;

  const holdings = useQuery(Holding).filtered(
    activePortfolio
      ? `portfolioId == oid(${activePortfolio._id.toHexString()}) AND isDisabled == false`
      : 'FALSEPREDICATE',
  );

  const allSnapshots = useQuery(DailySnapshot)
    .filtered(
      activePortfolio
        ? `portfolioId == oid(${activePortfolio._id.toHexString()})`
        : 'FALSEPREDICATE',
    )
    .sorted('date');

  const transactions = useQuery(Transaction)
    .filtered(
      activePortfolio
        ? `portfolioId == oid(${activePortfolio._id.toHexString()})`
        : 'FALSEPREDICATE',
    )
    .sorted('date');

  // ── 快照（按周期过滤）──
  const snapshots = useMemo(() => {
    const cutoff = periodStartDate(activePeriod);
    return Array.from(allSnapshots).filter(s => s.date >= cutoff);
  }, [allSnapshots, activePeriod]);

  // ── 总资产（实时）──
  const totalValue = Array.from(holdings).reduce((s, h) => s + h.shares * h.currentPrice, 0);
  const totalCost  = Array.from(holdings).reduce((s, h) => s + h.shares * h.avgCost, 0);
  const cash = Math.max(activePortfolio?.currentCapital ?? 0, 0);
  const totalAssets = totalValue + cash;
  const unrealizedPnl = totalValue - totalCost;
  const unrealizedPct = totalCost > 0 ? (unrealizedPnl / totalCost) * 100 : 0;
  const navPerUnit = (activePortfolio?.initialCapital ?? 0) > 0
    ? totalAssets / activePortfolio!.initialCapital : 1;

  // ── 周期内业绩指标 ──
  const navSeries  = snapshots.map(s => s.navPerUnit);
  const snapDates  = snapshots.map(s => s.date);
  const maxDD      = calcMaxDrawdown(navSeries);
  const snapSpanDays = snapDates.length >= 2
    ? (snapDates[snapDates.length - 1].getTime() - snapDates[0].getTime()) / 86400000
    : 0;
  const hasEnoughSnapData = snapshots.length >= 20 && snapSpanDays >= 60;
  const vol   = hasEnoughSnapData ? calcVolatility(navSeries, snapDates) : 0;
  const rfr   = getDefaultRiskFreeRate(activePortfolio?.market ?? 'US');

  const txsSortedAsc = useMemo(
    () => Array.from(transactions)
      .filter(tx => tx.ticker !== '__CASH__')  // 排除现金调整伪流水
      .sort((a, b) => a.date.getTime() - b.date.getTime()),
    [transactions],
  );
  const now = new Date();
  // 优先用快照序列的时间跨度计算年化（最准确）；无快照则用第一笔真实流水日期
  const totalDays = allSnapshots.length >= 2
    ? (allSnapshots[allSnapshots.length - 1].date.getTime() - allSnapshots[0].date.getTime()) / 86400000
    : txsSortedAsc.length > 0
      ? Math.max((now.getTime() - txsSortedAsc[0].date.getTime()) / 86400000, 1)
      : Math.max((now.getTime() - (activePortfolio?.createdAt ?? now).getTime()) / 86400000, 1);

  const initialCapital = activePortfolio?.initialCapital ?? 0;
  const totalReturn = initialCapital > 0 ? totalAssets / initialCapital - 1 : 0;
  const annReturn = annualizeReturn(totalReturn, totalDays);
  const sharpe = calcSharpe(annReturn, vol, rfr);

  // ── 已实现盈亏 ──
  const { totalRealized, realizedPnls } = useMemo(() => {
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
        const newAvgCost = newShares > 0 ? calcAvgCost(cb.shares, cb.avgCost, tx.shares, tx.price) : tx.price;
        costBasis.set(tx.ticker, { shares: newShares, avgCost: newAvgCost });
      } else if (tx.type === 'sell') {
        if (cb.shares > 0 && cb.avgCost > 0) {
          const realized = (tx.price - cb.avgCost) * tx.shares - tx.commission - tx.tax;
          pnls.push(realized);
          total += realized;
        }
        costBasis.set(tx.ticker, { shares: Math.max(0, cb.shares - tx.shares), avgCost: cb.avgCost });
      }
    }
    return { totalRealized: total, realizedPnls: pnls };
  }, [txsSortedAsc, holdings]);

  const sellTxs  = txsSortedAsc.filter(t => t.type === 'sell');
  const winRate  = calcWinRate(realizedPnls);
  const plRatio  = calcProfitLossRatio(realizedPnls);

  // ── 格式化 ──
  const fmtCurrency = (v: number) =>
    v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPct = (v: number) => isNaN(v) ? '--' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
  const fmtPctRaw = (v: number) => isNaN(v) ? '--' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

  const tranches = [
    { key: 'core',      label: '核心仓', color: Colors.coreColor },
    { key: 'satellite', label: '卫星仓', color: Colors.satelliteColor },
    { key: 'trading',   label: '交易仓', color: Colors.tradingColor },
  ];

  const styles = makeStyles(Colors);

  if (!activePortfolio) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>暂无组合</Text>
          <Text style={styles.emptySubText}>前往「持仓」页新建一个组合</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={isPriceLoading}
            onRefresh={() => activePortfolio && refreshPrices(activePortfolio._id.toHexString())}
            tintColor={Colors.primary}
          />
        }
        contentContainerStyle={styles.content}>
        {/* 顶部：组合名 + 刷新 */}
        <View style={styles.header}>
          <View>
            <Text style={styles.portfolioName}>{activePortfolio.name}</Text>
            <Text style={styles.currencyBadge}>{activePortfolio.currency}</Text>
          </View>
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={() => activePortfolio && refreshPrices(activePortfolio._id.toHexString())}
            disabled={isPriceLoading}>
            {isPriceLoading ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <Text style={styles.refreshBtnText}>⟳ 刷新行情</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* 资产总览大卡片 */}
        <View style={styles.assetCard}>
          <Text style={styles.assetLabel}>总资产</Text>
          <Text style={styles.assetValue}>{fmtCurrency(totalAssets)}</Text>
          <View style={styles.pnlRow}>
            <Text style={[styles.pnlText, { color: unrealizedPnl >= 0 ? Colors.profit : Colors.loss }]}>
              {unrealizedPnl >= 0 ? '+' : ''}{fmtCurrency(unrealizedPnl)}
            </Text>
            <Text style={[styles.pnlPct, { color: unrealizedPnl >= 0 ? Colors.profit : Colors.loss }]}>
              {fmtPctRaw(unrealizedPct)}
            </Text>
          </View>
          <Text style={styles.costText}>
            持仓市值 {fmtCurrency(totalValue)}  ·  现金 {fmtCurrency(cash)}
          </Text>
        </View>

        {/* 四格关键指标 */}
        <View style={styles.metricsGrid}>
          <MetricCard Colors={Colors} label="净值" value={navPerUnit.toFixed(4)} positive={navPerUnit >= 1} />
          <MetricCard Colors={Colors} label="年化收益" value={fmtPct(annReturn)} positive={!isNaN(annReturn) && annReturn >= 0} />
          <MetricCard Colors={Colors} label="最大回撤" value={navSeries.length >= 2 ? `-${(maxDD * 100).toFixed(2)}%` : '--'} negative={navSeries.length >= 2} />
          <MetricCard Colors={Colors} label="夏普比率" value={hasEnoughSnapData ? sharpe.toFixed(2) : '--'} />
        </View>

        {/* 仓位分布 */}
        <SectionCard Colors={Colors} title="仓位分布">
          {tranches.map(t => {
            const trancheValue = Array.from(holdings)
              .filter(h => h.tranche === t.key)
              .reduce((s, h) => s + h.shares * h.currentPrice, 0);
            const pct = totalAssets > 0 ? (trancheValue / totalAssets) * 100 : 0;
            return (
              <View key={t.key} style={styles.distRow}>
                <View style={[styles.trancheDot, { backgroundColor: t.color }]} />
                <Text style={styles.trancheLabel}>{t.label}</Text>
                <View style={styles.barBg}>
                  <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: t.color }]} />
                </View>
                <Text style={styles.distPct}>{pct.toFixed(1)}%</Text>
              </View>
            );
          })}
          {/* 现金行 */}
          {(() => {
            const cashPct = totalAssets > 0 ? (cash / totalAssets) * 100 : 0;
            return (
              <View style={styles.distRow}>
                <View style={[styles.trancheDot, { backgroundColor: Colors.cashColor }]} />
                <Text style={styles.trancheLabel}>现金</Text>
                <View style={styles.barBg}>
                  <View style={[styles.barFill, { width: `${cashPct}%`, backgroundColor: Colors.cashColor }]} />
                </View>
                <Text style={styles.distPct}>{cashPct.toFixed(1)}%</Text>
              </View>
            );
          })()}
        </SectionCard>

        {/* 周期选择器 */}
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

        {/* 收益卡片 */}
        <SectionCard Colors={Colors} title="收益">
          <StatRow Colors={Colors} label="累计收益率"  value={fmtPct(totalReturn)}           positive={totalReturn >= 0} />
          <StatRow Colors={Colors} label="年化收益率"  value={fmtPct(annReturn)}              positive={annReturn >= 0} />
          <StatRow Colors={Colors} label="已实现盈亏"  value={fmtCurrency(totalRealized)}     positive={totalRealized >= 0} />
          <StatRow Colors={Colors} label="未实现盈亏"  value={fmtCurrency(unrealizedPnl)}     positive={unrealizedPnl >= 0} />
        </SectionCard>

        {/* 风险卡片 */}
        <SectionCard Colors={Colors} title="风险">
          <StatRow Colors={Colors} label="最大回撤"   value={navSeries.length >= 2 ? `-${(maxDD * 100).toFixed(2)}%` : '数据不足'} negative={navSeries.length >= 2} />
          <StatRow Colors={Colors} label="年化波动率"  value={hasEnoughSnapData ? `${(vol * 100).toFixed(2)}%` : '数据不足'} />
          <StatRow Colors={Colors} label="夏普比率"   value={hasEnoughSnapData ? sharpe.toFixed(4) : '数据不足'} />
        </SectionCard>

        {/* 交易统计 */}
        <SectionCard Colors={Colors} title="交易统计">
          <StatRow Colors={Colors} label="卖出次数"  value={`${sellTxs.length} 笔`} />
          <StatRow Colors={Colors} label="胜率"      value={realizedPnls.length > 0 ? `${(winRate * 100).toFixed(1)}%` : '--'} />
          <StatRow Colors={Colors} label="盈亏比"    value={plRatio > 0 ? plRatio.toFixed(2) : (realizedPnls.length > 0 ? '无亏损' : '--')} />
        </SectionCard>

        {/* 分层业绩 */}
        <SectionCard Colors={Colors} title="分层业绩">
          {tranches.map(t => {
            const th   = Array.from(holdings).filter(h => h.tranche === t.key);
            const val  = th.reduce((s, h) => s + h.shares * h.currentPrice, 0);
            const cost = th.reduce((s, h) => s + h.shares * h.avgCost, 0);
            const pnl  = cost > 0 ? (val - cost) / cost : 0;
            return (
              <View key={t.key} style={styles.trancheRow}>
                <View style={[styles.trancheDot, { backgroundColor: t.color }]} />
                <Text style={styles.trancheLabel}>{t.label}</Text>
                <Text style={[styles.trancheValue, { color: pnl >= 0 ? Colors.profit : Colors.loss }]}>
                  {fmtPct(pnl)}
                </Text>
              </View>
            );
          })}
        </SectionCard>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── 子组件 ────────────────────────────────────────────────

function MetricCard({ Colors, label, value, positive, negative }: {
  Colors: ThemeColors; label: string; value: string; positive?: boolean; negative?: boolean;
}) {
  const color = negative ? Colors.loss : positive ? Colors.profit : Colors.textPrimary;
  const styles = makeStyles(Colors);
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
    </View>
  );
}

function SectionCard({ Colors, title, children }: {
  Colors: ThemeColors; title: string; children: React.ReactNode;
}) {
  const styles = makeStyles(Colors);
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function StatRow({ Colors, label, value, positive, negative }: {
  Colors: ThemeColors; label: string; value: string; positive?: boolean; negative?: boolean;
}) {
  const color = negative ? Colors.loss : positive ? Colors.profit : Colors.textPrimary;
  const styles = makeStyles(Colors);
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

// ─── 样式工厂 ───────────────────────────────────────────────

function makeStyles(C: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: C.background },
    periodBar: {
      flexDirection: 'row',
      backgroundColor: C.surface,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: C.border,
      marginBottom: Spacing.md,
    },
    periodItem: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm },
    periodItemActive: { borderBottomWidth: 2, borderBottomColor: C.primary },
    periodText: { fontSize: FontSize.sm, color: C.textTertiary },
    periodTextActive: { color: C.primary, fontWeight: FontWeight.semibold },
    content: { padding: Spacing.md },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: Spacing.md,
    },
    portfolioName: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: C.textPrimary },
    currencyBadge: {
      fontSize: FontSize.sm,
      color: C.textTertiary,
      backgroundColor: C.surfaceElevated,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      borderRadius: Radius.sm,
      alignSelf: 'flex-start',
      marginTop: 2,
    },
    refreshBtn: {
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
      backgroundColor: C.surfaceElevated,
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: C.border,
      minWidth: 80,
      alignItems: 'center',
    },
    refreshBtnText: { fontSize: FontSize.sm, color: C.primary },
    assetCard: {
      backgroundColor: C.surface,
      borderRadius: Radius.lg,
      padding: Spacing.lg,
      marginBottom: Spacing.md,
      borderWidth: 1,
      borderColor: C.border,
    },
    assetLabel: { fontSize: FontSize.sm, color: C.textTertiary, marginBottom: Spacing.xs },
    assetValue: { fontSize: FontSize.display, fontWeight: FontWeight.bold, color: C.textPrimary, marginBottom: Spacing.xs },
    pnlRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    pnlText: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
    pnlPct: { fontSize: FontSize.md, fontWeight: FontWeight.medium },
    costText: { fontSize: FontSize.sm, color: C.textTertiary, marginTop: Spacing.xs },
    metricsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.sm,
      marginBottom: Spacing.md,
    },
    metricCard: {
      flex: 1,
      minWidth: '45%',
      backgroundColor: C.surface,
      borderRadius: Radius.md,
      padding: Spacing.md,
      borderWidth: 1,
      borderColor: C.border,
    },
    metricLabel: { fontSize: FontSize.xs, color: C.textTertiary, marginBottom: Spacing.xs },
    metricValue: { fontSize: FontSize.xl, fontWeight: FontWeight.bold },
    sectionCard: {
      backgroundColor: C.surface,
      borderRadius: Radius.lg,
      padding: Spacing.md,
      marginBottom: Spacing.md,
      borderWidth: 1,
      borderColor: C.border,
    },
    sectionTitle: {
      fontSize: FontSize.md,
      fontWeight: FontWeight.semibold,
      color: C.textSecondary,
      marginBottom: Spacing.sm,
    },
    statRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: Spacing.xs,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    },
    statLabel: { fontSize: FontSize.sm, color: C.textSecondary },
    statValue: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: C.textPrimary },
    trancheRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: Spacing.xs,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    },
    trancheDot: { width: 8, height: 8, borderRadius: 4, marginRight: Spacing.sm },
    trancheLabel: { flex: 1, fontSize: FontSize.sm, color: C.textSecondary },
    trancheValue: { fontSize: FontSize.sm, fontWeight: FontWeight.medium },
    distRow: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.sm },
    barBg: {
      flex: 1,
      height: 6,
      backgroundColor: C.surfaceElevated,
      borderRadius: 3,
      marginHorizontal: Spacing.sm,
      overflow: 'hidden',
    },
    barFill: { height: '100%', borderRadius: 3 },
    distPct: { width: 42, fontSize: FontSize.sm, color: C.textPrimary, textAlign: 'right' },
    emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    emptyText: { fontSize: FontSize.xl, color: C.textPrimary, marginBottom: Spacing.sm },
    emptySubText: { fontSize: FontSize.md, color: C.textTertiary, textAlign: 'center' },
  });
}
