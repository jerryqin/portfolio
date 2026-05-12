import React, { useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
} from 'react-native';
import { useQuery } from '@realm/react';
import { Colors, Spacing, FontSize, FontWeight, Radius } from '../../theme';
import { Portfolio, Holding, DailySnapshot, Transaction } from '../../database/schema';
import { usePortfolioStore } from '../../store/portfolioStore';
import {
  calcMaxDrawdown,
  calcVolatility,
  calcSharpe,
  calcTWRR,
  annualizeReturn,
  getDefaultRiskFreeRate,
} from '../../utils/finance';

export default function DashboardScreen() {
  const { activePortfolioId, refreshPrices, isPriceLoading } =
    usePortfolioStore();

  const portfolios = useQuery(Portfolio).filtered('isArchived == false');
  const activePortfolio = portfolios.find(
    p => p._id.toHexString() === activePortfolioId,
  ) ?? portfolios[0] ?? null;

  const holdings = useQuery(Holding).filtered(
    activePortfolio
      ? `portfolioId == oid(${activePortfolio._id.toHexString()}) AND isDisabled == false`
      : 'FALSEPREDICATE',
  );

  const snapshots = useQuery(DailySnapshot)
    .filtered(
      activePortfolio
        ? `portfolioId == oid(${activePortfolio._id.toHexString()})`
        : 'FALSEPREDICATE',
    )
    .sorted('date');

  // 计算汇总数据
  const totalValue = holdings.reduce(
    (sum, h) => sum + h.shares * h.currentPrice,
    0,
  );
  const totalCost = holdings.reduce(
    (sum, h) => sum + h.shares * h.avgCost,
    0,
  );
  // currentCapital 是用户明确输入的现金余额，直接用不需任何偏移
  const cash = Math.max(activePortfolio?.currentCapital ?? 0, 0);
  const totalAssets = totalValue + cash;
  const unrealizedPnl = totalValue - totalCost;
  const unrealizedPct = totalCost > 0 ? (unrealizedPnl / totalCost) * 100 : 0;
  const navPerUnit =
    (activePortfolio?.initialCapital ?? 0) > 0
      ? totalAssets / activePortfolio!.initialCapital
      : 1;

  const navSeries = snapshots.map(s => s.navPerUnit);
  const snapDates = Array.from(snapshots).map(s => s.date);
  const maxDD = calcMaxDrawdown(navSeries);

  // 波动率需要足够多的快照（至少20个）且跨度足够长（至少60天），否则结果不可靠
  const snapSpanDays = snapDates.length >= 2
    ? (snapDates[snapDates.length - 1].getTime() - snapDates[0].getTime()) / 86400000
    : 0;
  const hasEnoughSnapData = snapshots.length >= 20 && snapSpanDays >= 60;
  const vol = hasEnoughSnapData ? calcVolatility(navSeries, snapDates) : 0;
  const rfr = getDefaultRiskFreeRate(activePortfolio?.market ?? 'US');

  // 年化收益率：与绩效分析页保持一致，用第一笔交易日期作为起始日
  const nowDate = new Date();
  const transactions = useQuery(Transaction).filtered(
    activePortfolio
      ? `portfolioId == oid(${activePortfolio._id.toHexString()})`
      : 'FALSEPREDICATE',
  ).sorted('date');
  const firstTxDate = transactions.length > 0 ? transactions[0].date : (activePortfolio?.createdAt ?? nowDate);
  const totalDays = Math.max((nowDate.getTime() - firstTxDate.getTime()) / 86400000, 1);
  const totalReturn = (activePortfolio?.initialCapital ?? 0) > 0
    ? totalAssets / activePortfolio!.initialCapital - 1
    : 0;
  const annReturn = annualizeReturn(totalReturn, totalDays);
  const sharpe = hasEnoughSnapData ? calcSharpe(annReturn, vol, rfr) : 0;

  const onRefresh = () => {
    if (activePortfolio) refreshPrices(activePortfolio._id.toHexString());
  };

  const fmtCurrency = (val: number) =>
    val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmtPct = (val: number) =>
    `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;

  if (!activePortfolio) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>暂无组合</Text>
          <Text style={styles.emptySubText}>前往「我的组合」新建一个</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (activePortfolio.isDraft || holdings.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.portfolioName}>{activePortfolio.name}</Text>
            <Text style={styles.currency}>{activePortfolio.currency}</Text>
          </View>
        </View>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            {activePortfolio.isDraft ? '组合尚未激活' : '暂无持仓'}
          </Text>
          <Text style={styles.emptySubText}>
            请前往「持仓明细」添加持仓，{'\n'}完成后在「我的组合」点击「激活」
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={isPriceLoading} onRefresh={onRefresh} tintColor={Colors.primary} />
        }>
        {/* 顶部标题 */}
        <View style={styles.header}>
          <View>
            <Text style={styles.portfolioName}>{activePortfolio.name}</Text>
            <Text style={styles.currency}>{activePortfolio.currency}</Text>
          </View>
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={onRefresh}
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
          <Text style={styles.assetValue}>
            {fmtCurrency(totalAssets)}
          </Text>
          <View style={styles.pnlRow}>
            <Text
              style={[
                styles.pnlText,
                { color: unrealizedPnl >= 0 ? Colors.profit : Colors.loss },
              ]}>
              {unrealizedPnl >= 0 ? '+' : ''}{fmtCurrency(unrealizedPnl)}
            </Text>
            <Text
              style={[
                styles.pnlPct,
                { color: unrealizedPnl >= 0 ? Colors.profit : Colors.loss },
              ]}>
              {fmtPct(unrealizedPct)}
            </Text>
          </View>
          <Text style={styles.costText}>
            持仓市值 {fmtCurrency(totalValue)}  ·  现金 {fmtCurrency(cash)}
          </Text>
        </View>

        {/* 四宫格指标 */}
        <View style={styles.metricsGrid}>
          <MetricCard label="净值" value={navPerUnit.toFixed(4)} positive={navPerUnit >= 1} />
          <MetricCard label="年化收益" value={fmtPct(annReturn * 100)} positive={annReturn >= 0} />
          <MetricCard label="最大回撤" value={navSeries.length >= 2 ? `-${(maxDD * 100).toFixed(2)}%` : '--'} negative={navSeries.length >= 2} />
          <MetricCard label="夏普比率" value={hasEnoughSnapData ? sharpe.toFixed(2) : '--'} />
        </View>

        {/* 仓位分布标题 */}
        <Text style={styles.sectionTitle}>仓位分布</Text>
        <TrancheSummary holdings={Array.from(holdings)} totalAssets={totalAssets} />
      </ScrollView>
    </SafeAreaView>
  );
}

function MetricCard({
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
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
    </View>
  );
}

function TrancheSummary({
  holdings,
  totalAssets,
}: {
  holdings: Holding[];
  totalAssets: number;
}) {
  const tranches = [
    { key: 'core', label: '核心仓', color: Colors.coreColor },
    { key: 'satellite', label: '卫星仓', color: Colors.satelliteColor },
    { key: 'trading', label: '交易仓', color: Colors.tradingColor },
  ];
  return (
    <View style={styles.trancheContainer}>
      {tranches.map(t => {
        const trancheValue = holdings
          .filter(h => h.tranche === t.key)
          .reduce((sum, h) => sum + h.shares * h.currentPrice, 0);
        const pct = totalAssets > 0 ? (trancheValue / totalAssets) * 100 : 0;
        return (
          <View key={t.key} style={styles.trancheRow}>
            <View style={[styles.trancheDot, { backgroundColor: t.color }]} />
            <Text style={styles.trancheLabel}>{t.label}</Text>
            <View style={styles.trancheBarBg}>
              <View
                style={[
                  styles.trancheBarFill,
                  { width: `${pct}%`, backgroundColor: t.color },
                ]}
              />
            </View>
            <Text style={styles.tranchePct}>{pct.toFixed(1)}%</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  refreshBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    minWidth: 80,
    alignItems: 'center',
  },
  refreshBtnText: {
    fontSize: FontSize.sm,
    color: Colors.primary,
  },
  portfolioName: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
  currency: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    backgroundColor: Colors.surfaceElevated,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.sm,
  },
  assetCard: {
    margin: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
  },
  assetLabel: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    marginBottom: Spacing.xs,
  },
  assetValue: {
    fontSize: FontSize.display,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  pnlRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  pnlText: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  pnlPct: { fontSize: FontSize.md, fontWeight: FontWeight.medium },
  costText: { fontSize: FontSize.sm, color: Colors.textTertiary, marginTop: Spacing.xs },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.sm,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  metricCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginHorizontal: Spacing.xs,
  },
  metricLabel: { fontSize: FontSize.xs, color: Colors.textTertiary, marginBottom: Spacing.xs },
  metricValue: { fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  sectionTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  trancheContainer: {
    marginHorizontal: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.xl,
  },
  trancheRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  trancheDot: { width: 8, height: 8, borderRadius: 4, marginRight: Spacing.sm },
  trancheLabel: {
    width: 56,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  trancheBarBg: {
    flex: 1,
    height: 6,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 3,
    marginHorizontal: Spacing.sm,
    overflow: 'hidden',
  },
  trancheBarFill: { height: '100%', borderRadius: 3 },
  tranchePct: { width: 42, fontSize: FontSize.sm, color: Colors.textPrimary, textAlign: 'right' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: FontSize.xl, color: Colors.textPrimary, marginBottom: Spacing.sm },
  emptySubText: { fontSize: FontSize.md, color: Colors.textTertiary },
});
