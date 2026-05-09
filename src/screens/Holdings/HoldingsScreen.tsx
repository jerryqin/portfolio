import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@realm/react';
import Realm from 'realm';
import { Colors, Spacing, FontSize, FontWeight, Radius } from '../../theme';
import { Holding, Portfolio, Transaction } from '../../database/schema';
import { usePortfolioStore } from '../../store/portfolioStore';
import ImportModal from './ImportModal';

type Tranche = 'core' | 'satellite' | 'trading';

const TRANCHE_LABELS: Record<Tranche, string> = {
  core: '核心仓',
  satellite: '卫星仓',
  trading: '交易仓',
};

const TRANCHE_COLORS: Record<Tranche, string> = {
  core: Colors.coreColor,
  satellite: Colors.satelliteColor,
  trading: Colors.tradingColor,
};

export default function HoldingsScreen() {
  const [activeTranche, setActiveTranche] = useState<Tranche>('core');
  const { activePortfolioId, setActivePortfolioId, addHolding, addTransaction, refreshPrices, isPriceLoading, deleteHolding } = usePortfolioStore();

  // 若无选中组合，自动选第一个已激活的组合
  const allActivePortfolios = useQuery(Portfolio)
    .filtered('isArchived == false AND isDraft == false')
    .sorted('createdAt', true);
  React.useEffect(() => {
    if (!activePortfolioId && allActivePortfolios.length > 0) {
      setActivePortfolioId(allActivePortfolios[0]._id.toHexString());
    }
  }, [activePortfolioId, allActivePortfolios.length]);

  // ── 导入 Modal ──
  const [importModal, setImportModal] = useState(false);

  // ── 添加持仓 Modal ──
  const [addModal, setAddModal] = useState(false);
  const [form, setForm] = useState({ ticker: '', name: '', targetWeight: '', shares: '', avgCost: '' });
  const openAddModal = () => {
    setForm({ ticker: '', name: '', targetWeight: '', shares: '', avgCost: '' });
    setAddModal(true);
  };
  const handleAddHolding = () => {
    if (!activePortfolioId) return;
    const ticker = form.ticker.trim().toUpperCase();
    if (!ticker) { Alert.alert('请输入股票代码'); return; }
    addHolding({
      portfolioId: activePortfolioId,
      ticker,
      name: form.name.trim() || ticker,
      tranche: activeTranche,
      targetWeight: parseFloat(form.targetWeight) || 0,
      shares: parseFloat(form.shares) || 0,
      avgCost: parseFloat(form.avgCost) || 0,
    });
    setAddModal(false);
  };

  // ── 交易记录 Modal ──
  const [txModal, setTxModal] = useState(false);
  const [selectedHolding, setSelectedHolding] = useState<Holding | null>(null);
  const [showTxForm, setShowTxForm] = useState(false);
  const TX_TYPES: { key: Transaction['type']; label: string }[] = [
    { key: 'buy', label: '买入' },
    { key: 'sell', label: '卖出' },
    { key: 'dividend', label: '分红' },
    { key: 'split', label: '拆股' },
  ];
  const [txForm, setTxForm] = useState({
    type: 'buy' as Transaction['type'],
    date: new Date().toISOString().slice(0, 10),
    price: '',
    shares: '',
    commission: '',
    tax: '',
    notes: '',
  });
  const openTxModal = (holding: Holding) => {
    setSelectedHolding(holding);
    setShowTxForm(false);
    setTxForm({ type: 'buy', date: new Date().toISOString().slice(0, 10), price: '', shares: '', commission: '', tax: '', notes: '' });
    setTxModal(true);
  };
  const handleAddTx = () => {
    if (!activePortfolioId || !selectedHolding) return;
    const price = parseFloat(txForm.price);
    const shares = parseFloat(txForm.shares);
    if (!price || !shares) { Alert.alert('请填写价格和数量'); return; }
    addTransaction({
      portfolioId: activePortfolioId,
      holdingId: selectedHolding._id.toHexString(),
      ticker: selectedHolding.ticker,
      type: txForm.type,
      date: new Date(txForm.date),
      price,
      shares,
      commission: parseFloat(txForm.commission) || 0,
      tax: parseFloat(txForm.tax) || 0,
      notes: txForm.notes,
    });
    setShowTxForm(false);
    setTxForm({ type: 'buy', date: new Date().toISOString().slice(0, 10), price: '', shares: '', commission: '', tax: '', notes: '' });
  };

  const handleDeleteHolding = (holding: Holding) => {
    Alert.alert(
      '删除持仓',
      `确认删除「${holding.ticker}${holding.name ? ' ' + holding.name : ''}」？将同时删除该标的全部交易流水，不可恢复。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => deleteHolding(holding._id.toHexString()),
        },
      ],
    );
  };

  const holdings = useQuery(Holding)
    .filtered(
      activePortfolioId
        ? `portfolioId == oid(${activePortfolioId}) AND isDisabled == false AND tranche == $0`
        : 'FALSEPREDICATE',
      activeTranche,
    )
    .sorted('targetWeight', true);

  const allHoldings = useQuery(Holding).filtered(
    activePortfolioId
      ? `portfolioId == oid(${activePortfolioId}) AND isDisabled == false`
      : 'FALSEPREDICATE',
  );

  // 总资产 = 持仓总市值 + 现金（currentCapital 直接代表现金余额）
  const activePortfolio = allActivePortfolios.find(
    p => p._id.toHexString() === activePortfolioId,
  ) ?? allActivePortfolios[0] ?? null;
  const totalMarketValue = allHoldings.reduce(
    (sum, h) => sum + h.shares * h.currentPrice,
    0,
  );
  const totalCost = allHoldings.reduce(
    (sum, h) => sum + h.shares * h.avgCost,
    0,
  );
  // currentCapital 是用户明确输入的现金余额，直接用不需任何偏移
  const cash = Math.max(activePortfolio?.currentCapital ?? 0, 0);
  const totalAssets = totalMarketValue + cash;

  const trancheHoldings = allHoldings.filtered('tranche == $0', activeTranche);

  const trancheValue = trancheHoldings.reduce(
    (sum, h) => sum + h.shares * h.currentPrice,
    0,
  );
  const trancheCost = trancheHoldings.reduce(
    (sum, h) => sum + h.shares * h.avgCost,
    0,
  );
  const tranchePnl = trancheValue - trancheCost;
  const tranchePnlPct = trancheCost > 0 ? (tranchePnl / trancheCost) * 100 : 0;

  const totalTargetWeight = trancheHoldings.reduce(
    (sum, h) => sum + h.targetWeight,
    0,
  );
  const totalActualWeight =
    totalAssets > 0 ? (trancheValue / totalAssets) * 100 : 0;

  const fmtCurrency = (v: number) =>
    v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const renderHolding = ({ item }: { item: Holding }) => {
    const marketValue = item.shares * item.currentPrice;
    const cost = item.shares * item.avgCost;
    const pnl = marketValue - cost;
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
    const actualWeight = totalAssets > 0 ? (marketValue / totalAssets) * 100 : 0;
    const weightDiff = actualWeight - item.targetWeight;

    return (
      <TouchableOpacity
        style={styles.holdingCell}
        onPress={() => openTxModal(item)}
        onLongPress={() => handleDeleteHolding(item)}
        delayLongPress={600}>
        <View style={styles.holdingTop}>
          <View>
            <Text style={styles.ticker}>{item.ticker}</Text>
            <Text style={styles.holdingName}>{item.name}</Text>
          </View>
          <View style={styles.holdingRight}>
            <Text style={styles.marketValue}>{fmtCurrency(marketValue)}</Text>
            <Text
              style={[
                styles.pnl,
                { color: pnl >= 0 ? Colors.profit : Colors.loss },
              ]}>
              {pnl >= 0 ? '+' : ''}{fmtCurrency(pnl)} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
            </Text>
          </View>
        </View>

        <View style={styles.weightRow}>
          <WeightBadge label="目标" value={item.targetWeight} />
          <WeightBadge label="实际" value={actualWeight} />
          <WeightBadge
            label="偏差"
            value={weightDiff}
            color={Math.abs(weightDiff) > 5 ? Colors.loss : Colors.neutral}
            sign
          />
          <Text style={styles.shares}>{item.shares.toFixed(2)} 股</Text>
        </View>
        <View style={styles.priceRow}>
          <Text style={styles.currentPrice}>现价 {item.currentPrice.toFixed(2)}</Text>
          {item.priceUpdatedAt && (
            <Text style={styles.priceTime}>
              {item.priceUpdatedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* 分段控制器 */}
      <View style={styles.segmentRow}>
        <View style={styles.segmentBar}>
          {(Object.keys(TRANCHE_LABELS) as Tranche[]).map(t => (
            <TouchableOpacity
              key={t}
              style={[
                styles.segmentItem,
                activeTranche === t && {
                  borderBottomWidth: 2,
                  borderBottomColor: TRANCHE_COLORS[t],
                },
              ]}
              onPress={() => setActiveTranche(t)}>
              <Text
                style={[
                  styles.segmentText,
                  activeTranche === t && { color: TRANCHE_COLORS[t] },
                ]}>
                {TRANCHE_LABELS[t]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          style={[styles.addBtn, !activePortfolioId && { opacity: 0.4 }]}
          onPress={() => {
            if (!activePortfolioId) {
              Alert.alert('提示', '请先在「我的组合」中激活一个组合');
              return;
            }
            openAddModal();
          }}>
          <Text style={styles.addBtnText}>+ 添加</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.importBtnSmall, !activePortfolioId && { opacity: 0.4 }]}
          onPress={() => {
            if (!activePortfolioId) {
              Alert.alert('提示', '请先在「我的组合」中激活一个组合');
              return;
            }
            setImportModal(true);
          }}>
          <Text style={styles.addBtnText}>↑ 导入</Text>
        </TouchableOpacity>
      </View>

      {/* 分层统计头 */}
      <View style={styles.trancheHeader}>
        <View style={styles.trancheStatItem}>
          <Text style={styles.trancheStatLabel}>层总市值</Text>
          <Text style={styles.trancheStatValue}>{fmtCurrency(trancheValue)}</Text>
        </View>
        <View style={styles.trancheStatItem}>
          <Text style={styles.trancheStatLabel}>层盈亏</Text>
          <Text style={[styles.trancheStatValue, { color: tranchePnl >= 0 ? Colors.profit : Colors.loss }]}>
            {tranchePnl >= 0 ? '+' : ''}{tranchePnlPct.toFixed(2)}%
          </Text>
        </View>
        <View style={styles.trancheStatItem}>
          <Text style={styles.trancheStatLabel}>目标仓位</Text>
          <Text style={styles.trancheStatValue}>{totalTargetWeight.toFixed(1)}%</Text>
        </View>
        <View style={styles.trancheStatItem}>
          <Text style={styles.trancheStatLabel}>实际仓位</Text>
          <Text style={styles.trancheStatValue}>{totalActualWeight.toFixed(1)}%</Text>
        </View>
      </View>

      <FlatList
        data={Array.from(holdings)}
        keyExtractor={item => item._id.toHexString()}
        renderItem={renderHolding}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isPriceLoading}
            onRefresh={() => activePortfolioId && refreshPrices(activePortfolioId)}
            tintColor={Colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>该仓位暂无持仓</Text>
          </View>
        }
      />

      {/* 添加持仓 Modal */}
      <Modal visible={addModal} transparent animationType="slide" onRequestClose={() => setAddModal(false)}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              添加持仓 · {TRANCHE_LABELS[activeTranche]}
            </Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.inputLabel}>股票代码 *</Text>
              <TextInput style={styles.input} placeholder="例如 AAPL" placeholderTextColor={Colors.textTertiary}
                value={form.ticker} onChangeText={v => setForm(f => ({ ...f, ticker: v }))} autoCapitalize="characters" autoFocus />
              <Text style={styles.inputLabel}>股票名称（选填）</Text>
              <TextInput style={styles.input} placeholder="例如 苹果公司" placeholderTextColor={Colors.textTertiary}
                value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))} />
              <Text style={styles.inputLabel}>目标仓位 %</Text>
              <TextInput style={styles.input} placeholder="0" placeholderTextColor={Colors.textTertiary}
                value={form.targetWeight} onChangeText={v => setForm(f => ({ ...f, targetWeight: v }))} keyboardType="decimal-pad" />
              <Text style={styles.inputLabel}>持仓股数</Text>
              <TextInput style={styles.input} placeholder="0" placeholderTextColor={Colors.textTertiary}
                value={form.shares} onChangeText={v => setForm(f => ({ ...f, shares: v }))} keyboardType="decimal-pad" />
              <Text style={styles.inputLabel}>平均成本（每股）</Text>
              <TextInput style={styles.input} placeholder="0.00" placeholderTextColor={Colors.textTertiary}
                value={form.avgCost} onChangeText={v => setForm(f => ({ ...f, avgCost: v }))} keyboardType="decimal-pad" />
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.cancelBtn]} onPress={() => setAddModal(false)}>
                <Text style={[styles.modalBtnText, { color: Colors.textSecondary }]}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.confirmBtn]} onPress={handleAddHolding}>
                <Text style={styles.modalBtnText}>确认添加</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 交易记录 Modal */}
      {selectedHolding && (
        <TxModal
          visible={txModal}
          holding={selectedHolding}
          activePortfolioId={activePortfolioId}
          showForm={showTxForm}
          txForm={txForm}
          txTypes={TX_TYPES}
          onOpenForm={() => setShowTxForm(true)}
          onClose={() => { setTxModal(false); setShowTxForm(false); }}
          onChangeTxForm={(patch) => setTxForm(f => ({ ...f, ...patch }))}
          onSubmitTx={handleAddTx}
        />
      )}

      {/* 导入 Modal */}
      {activePortfolioId && (
        <ImportModal
          visible={importModal}
          portfolioId={activePortfolioId}
          onClose={() => setImportModal(false)}
          onImported={() => setImportModal(false)}
        />
      )}
    </SafeAreaView>
  );
}

// ─── 交易记录 Modal 独立组件 ───────────────────────────────
function TxModal({
  visible, holding, activePortfolioId, showForm, txForm, txTypes,
  onOpenForm, onClose, onChangeTxForm, onSubmitTx,
}: {
  visible: boolean;
  holding: Holding;
  activePortfolioId: string | null;
  showForm: boolean;
  txForm: { type: Transaction['type']; date: string; price: string; shares: string; commission: string; tax: string; notes: string };
  txTypes: { key: Transaction['type']; label: string }[];
  onOpenForm: () => void;
  onClose: () => void;
  onChangeTxForm: (patch: Partial<typeof txForm>) => void;
  onSubmitTx: () => void;
}) {
  const transactions = useQuery(Transaction)
    .filtered('holdingId == $0', holding._id)
    .sorted('date', true);

  const TX_TYPE_COLORS: Record<string, string> = {
    buy: Colors.profit,
    sell: Colors.loss,
    dividend: Colors.primary,
    split: Colors.satelliteColor,
  };
  const TX_TYPE_LABELS: Record<string, string> = {
    buy: '买入', sell: '卖出', dividend: '分红', split: '拆股',
  };

  const fmtDate = (d: Date) =>
    `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.modalCard, { maxHeight: '90%' }]}>
          {/* 头部 */}
          <View style={txStyles.header}>
            <View>
              <Text style={styles.modalTitle}>{holding.ticker} · 交易记录</Text>
              <Text style={txStyles.holdingMeta}>
                持仓 {holding.shares.toFixed(2)} 股 · 均价 {holding.avgCost.toFixed(2)}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose}><Text style={txStyles.closeBtn}>✕</Text></TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* 历史流水 */}
            {transactions.length === 0 ? (
              <Text style={txStyles.emptyTx}>暂无交易记录</Text>
            ) : (
              Array.from(transactions).map(tx => (
                <View key={tx._id.toHexString()} style={txStyles.txRow}>
                  <View style={[txStyles.typeBadge, { backgroundColor: TX_TYPE_COLORS[tx.type] + '22' }]}>
                    <Text style={[txStyles.typeText, { color: TX_TYPE_COLORS[tx.type] }]}>
                      {TX_TYPE_LABELS[tx.type] ?? tx.type}
                    </Text>
                  </View>
                  <View style={txStyles.txMid}>
                    <Text style={txStyles.txShares}>
                      {tx.shares > 0 ? '+' : ''}{tx.shares} 股 @ {tx.price.toFixed(2)}
                    </Text>
                    <Text style={txStyles.txDate}>{fmtDate(tx.date)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={txStyles.txAmount}>
                      {(tx.shares * tx.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Text>
                    {(tx.commission + tx.tax) > 0 && (
                      <Text style={txStyles.txFee}>费 {(tx.commission + tx.tax).toFixed(2)}</Text>
                    )}
                  </View>
                </View>
              ))
            )}

            {/* 新增交易表单 */}
            {showForm ? (
              <View style={txStyles.formBox}>
                <Text style={txStyles.formTitle}>新增交易</Text>
                {/* 交易类型选择 */}
                <View style={txStyles.typeRow}>
                  {txTypes.map(t => (
                    <TouchableOpacity
                      key={t.key}
                      style={[txStyles.typeBtn, txForm.type === t.key && { backgroundColor: Colors.primary }]}
                      onPress={() => onChangeTxForm({ type: t.key })}>
                      <Text style={[txStyles.typeBtnText, txForm.type === t.key && { color: '#fff' }]}>{t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.inputLabel}>日期 (YYYY-MM-DD)</Text>
                <TextInput style={styles.input} placeholderTextColor={Colors.textTertiary}
                  value={txForm.date} onChangeText={v => onChangeTxForm({ date: v })} keyboardType="numbers-and-punctuation" />
                <Text style={styles.inputLabel}>价格（每股）*</Text>
                <TextInput style={styles.input} placeholder="0.00" placeholderTextColor={Colors.textTertiary}
                  value={txForm.price} onChangeText={v => onChangeTxForm({ price: v })} keyboardType="decimal-pad" />
                <Text style={styles.inputLabel}>股数 *</Text>
                <TextInput style={styles.input} placeholder="0" placeholderTextColor={Colors.textTertiary}
                  value={txForm.shares} onChangeText={v => onChangeTxForm({ shares: v })} keyboardType="decimal-pad" />
                <Text style={styles.inputLabel}>手续费</Text>
                <TextInput style={styles.input} placeholder="0.00" placeholderTextColor={Colors.textTertiary}
                  value={txForm.commission} onChangeText={v => onChangeTxForm({ commission: v })} keyboardType="decimal-pad" />
                <Text style={styles.inputLabel}>税费（印花税等）</Text>
                <TextInput style={styles.input} placeholder="0.00" placeholderTextColor={Colors.textTertiary}
                  value={txForm.tax} onChangeText={v => onChangeTxForm({ tax: v })} keyboardType="decimal-pad" />
                <Text style={styles.inputLabel}>备注</Text>
                <TextInput style={styles.input} placeholder="选填" placeholderTextColor={Colors.textTertiary}
                  value={txForm.notes} onChangeText={v => onChangeTxForm({ notes: v })} />
                <View style={[styles.modalActions, { marginBottom: Spacing.sm }]}>
                  <TouchableOpacity style={[styles.modalBtn, styles.cancelBtn]} onPress={() => onChangeTxForm({ type: 'buy' })}>
                    <Text style={[styles.modalBtnText, { color: Colors.textSecondary }]}>重置</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.modalBtn, styles.confirmBtn]} onPress={onSubmitTx}>
                    <Text style={styles.modalBtnText}>确认录入</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity style={txStyles.addTxBtn} onPress={onOpenForm}>
                <Text style={txStyles.addTxText}>+ 录入新交易</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function WeightBadge({
  label,
  value,
  color,
  sign,
}: {
  label: string;
  value: number;
  color?: string;
  sign?: boolean;
}) {
  return (
    <View style={weightStyles.badge}>
      <Text style={weightStyles.label}>{label}</Text>
      <Text style={[weightStyles.value, color ? { color } : undefined]}>
        {sign && value >= 0 ? '+' : ''}{value.toFixed(1)}%
      </Text>
    </View>
  );
}

const weightStyles = StyleSheet.create({
  badge: { alignItems: 'center', marginRight: Spacing.md },
  label: { fontSize: FontSize.xs, color: Colors.textTertiary },
  value: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.textPrimary },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  segmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  segmentBar: {
    flex: 1,
    flexDirection: 'row',
  },
  addBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.sm,
    marginRight: Spacing.sm,
  },
  importBtnSmall: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: Spacing.sm,
  },
  addBtnText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    color: Colors.textPrimary,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  segmentText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.textTertiary,
  },
  trancheHeader: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceElevated,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  trancheStatItem: { flex: 1, alignItems: 'center' },
  trancheStatLabel: { fontSize: FontSize.xs, color: Colors.textTertiary },
  trancheStatValue: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textPrimary },
  list: { padding: Spacing.sm },
  holdingCell: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  holdingTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.sm },
  ticker: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  holdingName: { fontSize: FontSize.xs, color: Colors.textTertiary },
  holdingRight: { alignItems: 'flex-end' },
  marketValue: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textPrimary },
  pnl: { fontSize: FontSize.xs },
  weightRow: { flexDirection: 'row', alignItems: 'center' },
  shares: { marginLeft: 'auto', fontSize: FontSize.xs, color: Colors.textTertiary },
  priceRow: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.xs, gap: Spacing.sm },
  currentPrice: { fontSize: FontSize.xs, color: Colors.textSecondary },
  priceTime: { fontSize: FontSize.xs, color: Colors.textTertiary },
  empty: { alignItems: 'center', paddingTop: Spacing.xxl },
  emptyText: { color: Colors.textTertiary, fontSize: FontSize.md },

  // Modal
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },
  inputLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
    marginTop: Spacing.sm,
  },
  input: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.textPrimary,
  },
  modalActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    alignItems: 'center',
  },
  cancelBtn: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  confirmBtn: { backgroundColor: Colors.primary },
  modalBtnText: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
    color: Colors.textPrimary,
  },
});

const txStyles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.md },
  holdingMeta: { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: 2 },
  closeBtn: { fontSize: FontSize.lg, color: Colors.textTertiary, padding: Spacing.xs },
  emptyTx: { color: Colors.textTertiary, fontSize: FontSize.sm, textAlign: 'center', paddingVertical: Spacing.md },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.sm,
  },
  typeBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.sm,
    minWidth: 44,
    alignItems: 'center',
  },
  typeText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  txMid: { flex: 1 },
  txShares: { fontSize: FontSize.sm, color: Colors.textPrimary },
  txDate: { fontSize: FontSize.xs, color: Colors.textTertiary },
  txAmount: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.textPrimary },
  txFee: { fontSize: FontSize.xs, color: Colors.textTertiary },
  addTxBtn: {
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  addTxText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  formBox: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  formTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textPrimary, marginBottom: Spacing.sm },
  typeRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  typeBtn: {
    flex: 1,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  typeBtnText: { fontSize: FontSize.xs, color: Colors.textSecondary },
});
