import React, { useState, useRef, useEffect } from 'react';
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
  useWindowDimensions,
  InteractionManager,
  NativeScrollEvent,
  NativeSyntheticEvent,
  SafeAreaView,
} from 'react-native';
import { useQuery, useRealm } from '@realm/react';
import { Colors, Spacing, FontSize, FontWeight, Radius, ThemeColors } from '../../theme';
import { useColors } from '../../theme/useColors';
import { Holding, Portfolio, PortfolioSnapshot, Transaction } from '../../database/schema';
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
  const Colors = useColors();
  const { width: screenWidth } = useWindowDimensions();
  const realm = useRealm();
  const {
    activePortfolioId, setActivePortfolioId,
    addHolding, addTransaction, refreshPrices, isPriceLoading, deleteHolding,
    activatePortfolio, createPortfolio, deletePortfolio,
    saveSnapshot, restoreSnapshot, deleteSnapshot,
  } = usePortfolioStore();

  // ── 仓位分层 ──
  const [activeTranche, setActiveTranche] = useState<Tranche>('core');

  // ── 所有非归档组合 ──
  const portfoliosQuery = useQuery(Portfolio)
    .filtered('isArchived == false')
    .sorted('createdAt', true);
  const portfolioList = Array.from(portfoliosQuery);

  // 若无选中组合，自动选第一个已激活的组合
  useEffect(() => {
    if (!activePortfolioId && portfolioList.length > 0) {
      const first = portfolioList.find(p => !p.isDraft) ?? portfolioList[0];
      setActivePortfolioId(first._id.toHexString());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePortfolioId, portfolioList.length]);

  // ── 卡片 Swiper ──
  const swiperRef = useRef<FlatList>(null);
  const [cardIndex, setCardIndex] = useState(0);

  useEffect(() => {
    if (!activePortfolioId) return;
    const idx = portfolioList.findIndex(p => p._id.toHexString() === activePortfolioId);
    if (idx >= 0 && idx !== cardIndex) {
      setCardIndex(idx);
      swiperRef.current?.scrollToIndex({ index: idx, animated: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePortfolioId]);

  const handleCardScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
    const p = portfolioList[idx];
    if (p && idx !== cardIndex) {
      setCardIndex(idx);
      setActivePortfolioId(p._id.toHexString());
    }
  };

  // ── 新建组合 Modal ──
  const [createModal, setCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCapital, setNewCapital] = useState('');
  const [newCash, setNewCash] = useState('');
  const handleConfirmCreate = () => {
    const name = newName.trim() || '新组合';
    const capital = parseFloat(newCapital) || 0;
    const cash = parseFloat(newCash);
    const initialCash = isNaN(cash) ? 0 : cash;
    const id = createPortfolio({ name, market: 'US', currency: 'USD', initialCapital: capital, currentCapital: initialCash });
    setActivePortfolioId(id);
    setCreateModal(false);
    setNewName(''); setNewCapital(''); setNewCash('');
  };

  // ── 编辑现金 Modal ──
  const [cashModal, setCashModal] = useState(false);
  const [cashTarget, setCashTarget] = useState<Portfolio | null>(null);
  const [editCashValue, setEditCashValue] = useState('');
  const handleOpenCashEdit = (portfolio: Portfolio) => {
    setCashTarget(portfolio);
    setEditCashValue(portfolio.currentCapital.toFixed(2));
    setCashModal(true);
  };
  const handleConfirmCashEdit = () => {
    if (!cashTarget) return;
    const val = parseFloat(editCashValue);
    if (isNaN(val)) { Alert.alert('请输入有效数字'); return; }
    realm.write(() => {
      cashTarget.currentCapital = val;
      cashTarget.updatedAt = new Date();
    });
    setCashModal(false);
  };

  // ── 快照 Modal ──
  const [snapshotModal, setSnapshotModal] = useState(false);
  const [snapshotTarget, setSnapshotTarget] = useState<Portfolio | null>(null);
  const [newSnapshotLabel, setNewSnapshotLabel] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const allSnapshots = useQuery(PortfolioSnapshot).sorted('createdAt', true);
  const handleOpenSnapshots = (portfolio: Portfolio) => {
    setSnapshotTarget(portfolio);
    setNewSnapshotLabel('');
    setSnapshotModal(true);
  };
  const handleSaveSnapshot = () => {
    if (!snapshotTarget) return;
    const label = newSnapshotLabel.trim() || new Date().toLocaleString('zh-CN');
    saveSnapshot(snapshotTarget._id.toHexString(), label);
    setNewSnapshotLabel('');
    Alert.alert('已保存', `快照「${label}」保存成功。`);
  };
  const handleRestoreSnapshot = (snapshotId: string) => {
    Alert.alert('恢复快照', '确认恢复历史净值序列？当前持仓和交易数据不会改变。', [
      { text: '取消', style: 'cancel' },
      {
        text: '恢复', style: 'destructive',
        onPress: () => {
          setSnapshotModal(false);
          setIsRestoring(true);
          InteractionManager.runAfterInteractions(() => {
            try {
              restoreSnapshot(snapshotId);
            } finally {
              setIsRestoring(false);
            }
          });
        },
      },
    ]);
  };
  const handleDeleteSnapshot = (snapshotId: string) => {
    Alert.alert('删除快照', '确认删除？', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => deleteSnapshot(snapshotId) },
    ]);
  };

  // ── 组合操作 ──
  const handleActivate = (portfolio: Portfolio) => {
    const id = portfolio._id.toHexString();
    const result = activatePortfolio(id);
    if (!result.ok) { Alert.alert('无法激活', result.error); }
    else { setActivePortfolioId(id); }
  };
  const handleArchive = (portfolio: Portfolio) => {
    Alert.alert('归档组合', `确认归档「${portfolio.name}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '归档', style: 'destructive',
        onPress: () => realm.write(() => { portfolio.isArchived = true; portfolio.updatedAt = new Date(); }),
      },
    ]);
  };
  const handleDelete = (portfolio: Portfolio) => {
    Alert.alert('删除组合', `确认删除「${portfolio.name}」？将同时删除全部持仓和交易流水。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => deletePortfolio(portfolio._id.toHexString()) },
    ]);
  };

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
  const activePortfolioObj = portfolioList.find(p => p._id.toHexString() === activePortfolioId) ?? null;
  const totalMarketValue = allHoldings.reduce(
    (sum, h) => sum + h.shares * h.currentPrice,
    0,
  );
  const totalCost = allHoldings.reduce(
    (sum, h) => sum + h.shares * h.avgCost,
    0,
  );
  // currentCapital 是用户明确输入的现金余额，直接用不需任何偏移
  const cash = Math.max(activePortfolioObj?.currentCapital ?? 0, 0);
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

  const styles = makeStyles(Colors);

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
      {/* ─── 组合卡片 Swiper ─── */}
      <View style={styles.swiperSection}>
        {portfolioList.length === 0 ? (
          <View style={styles.emptyCardWrap}>
            <Text style={styles.emptyCardText}>还没有组合</Text>
            <TouchableOpacity style={styles.createFirstBtn} onPress={() => setCreateModal(true)}>
              <Text style={styles.createFirstBtnText}>+ 新建组合</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            ref={swiperRef}
            data={portfolioList}
            keyExtractor={item => item._id.toHexString()}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleCardScrollEnd}
            getItemLayout={(_, index) => ({ length: screenWidth, offset: screenWidth * index, index })}
            renderItem={({ item }) => (
              <PortfolioCard
                portfolio={item}
                isActive={item._id.toHexString() === activePortfolioId}
                screenWidth={screenWidth}
                onOpenCashEdit={() => handleOpenCashEdit(item)}
                onOpenSnapshots={() => handleOpenSnapshots(item)}
                onActivate={() => handleActivate(item)}
                onArchive={() => handleArchive(item)}
                onDelete={() => handleDelete(item)}
              />
            )}
          />
        )}
        {/* 新建按钮 */}
        <TouchableOpacity style={styles.addPortfolioBtn} onPress={() => setCreateModal(true)}>
          <Text style={styles.addPortfolioBtnText}>+ 新建</Text>
        </TouchableOpacity>
        {/* 翻页圆点 */}
        {portfolioList.length > 1 && (
          <View style={styles.dotsRow}>
            {portfolioList.map((_, i) => (
              <View key={i} style={[styles.dot, i === cardIndex && styles.dotActive]} />
            ))}
          </View>
        )}
      </View>

      {/* ─── 分段控制器 ─── */}
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
              Alert.alert('提示', '请先激活一个组合');
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
              Alert.alert('提示', '请先激活一个组合');
              return;
            }
            setImportModal(true);
          }}>
          <Text style={styles.addBtnText}>↑ 导入</Text>
        </TouchableOpacity>
      </View>

      {/* ─── 分层统计头 ─── */}
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

      {/* ─── 新建组合 Modal ─── */}
      <Modal visible={createModal} transparent animationType="fade" onRequestClose={() => setCreateModal(false)}>
        <KeyboardAvoidingView style={styles.overlayCentered} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCardCenter}>
            <Text style={styles.modalTitle}>新建组合</Text>
            <Text style={styles.inputLabel}>组合名称</Text>
            <TextInput style={styles.input} placeholder="例如：成长股组合" placeholderTextColor={Colors.textTertiary}
              value={newName} onChangeText={setNewName} returnKeyType="next" autoFocus />
            <Text style={styles.inputLabel}>初始总资产（USD，Statement 页面的总市值）</Text>
            <TextInput style={styles.input} placeholder="0.00" placeholderTextColor={Colors.textTertiary}
              value={newCapital} onChangeText={setNewCapital} keyboardType="decimal-pad" returnKeyType="next" />
            <Text style={styles.inputLabel}>初始现金余额（USD，Statement 页面的 Cash 金额）</Text>
            <TextInput style={styles.input} placeholder="0.00" placeholderTextColor={Colors.textTertiary}
              value={newCash} onChangeText={setNewCash} keyboardType="decimal-pad" returnKeyType="done" onSubmitEditing={handleConfirmCreate} />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.cancelBtn]} onPress={() => setCreateModal(false)}>
                <Text style={[styles.modalBtnText, { color: Colors.textSecondary }]}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.confirmBtn]} onPress={handleConfirmCreate}>
                <Text style={styles.modalBtnText}>创建</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── 编辑现金余额 Modal ─── */}
      <Modal visible={cashModal} transparent animationType="fade" onRequestClose={() => setCashModal(false)}>
        <KeyboardAvoidingView style={styles.overlayCentered} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCardCenter}>
            <Text style={styles.modalTitle}>编辑现金余额</Text>
            <Text style={[styles.inputLabel, { marginBottom: Spacing.sm }]}>
              直接输入账户当前的现金余额（USD）
            </Text>
            <TextInput style={styles.input} placeholder="0.00" placeholderTextColor={Colors.textTertiary}
              value={editCashValue} onChangeText={setEditCashValue} keyboardType="decimal-pad"
              returnKeyType="done" onSubmitEditing={handleConfirmCashEdit} autoFocus />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.cancelBtn]} onPress={() => setCashModal(false)}>
                <Text style={[styles.modalBtnText, { color: Colors.textSecondary }]}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.confirmBtn]} onPress={handleConfirmCashEdit}>
                <Text style={styles.modalBtnText}>确认</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── 快照管理 Modal ─── */}
      <Modal visible={snapshotModal} transparent animationType="slide" onRequestClose={() => setSnapshotModal(false)}>
        <KeyboardAvoidingView style={styles.snapshotOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setSnapshotModal(false)} />
          <View style={styles.snapshotSheet}>
            <View style={styles.snapshotHeader}>
              <Text style={styles.snapshotTitle}>快照 · {snapshotTarget?.name ?? ''}</Text>
              <TouchableOpacity onPress={() => setSnapshotModal(false)}>
                <Text style={styles.snapshotClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.snapshotList} showsVerticalScrollIndicator={false}>
              {Array.from(allSnapshots)
                .filter(s => s.portfolioId.toHexString() === snapshotTarget?._id.toHexString())
                .map(s => (
                  <View key={s._id.toHexString()} style={styles.snapshotRow}>
                    <View style={styles.snapshotRowInfo}>
                      <Text style={styles.snapshotLabel}>{s.label}</Text>
                      <Text style={styles.snapshotDate}>
                        {s.createdAt.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.restoreBtn, isRestoring && { opacity: 0.4 }]}
                      disabled={isRestoring}
                      onPress={() => handleRestoreSnapshot(s._id.toHexString())}>
                      <Text style={styles.restoreBtnText}>{isRestoring ? '恢复中…' : '恢复'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.snapshotDelBtn} onPress={() => handleDeleteSnapshot(s._id.toHexString())}>
                      <Text style={styles.snapshotDelBtnText}>删除</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              {Array.from(allSnapshots).filter(s => s.portfolioId.toHexString() === snapshotTarget?._id.toHexString()).length === 0 && (
                <Text style={styles.snapshotEmpty}>暂无快照，点击下方「保存快照」创建</Text>
              )}
            </ScrollView>
            <View style={styles.snapshotSaveArea}>
              <TextInput
                style={styles.snapshotInput}
                placeholder="快照备注（可选）"
                placeholderTextColor={Colors.textTertiary}
                value={newSnapshotLabel}
                onChangeText={setNewSnapshotLabel}
                returnKeyType="done"
                onSubmitEditing={handleSaveSnapshot}
                blurOnSubmit={false}
              />
              <TouchableOpacity style={styles.saveSnapshotBtn} onPress={handleSaveSnapshot}>
                <Text style={styles.saveSnapshotBtnText}>保存快照</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

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

// ─── 组合卡片独立组件（独立查询 Holdings 计算总资产）─────────
function PortfolioCard({
  portfolio, isActive, screenWidth,
  onOpenCashEdit, onOpenSnapshots, onActivate, onArchive, onDelete,
}: {
  portfolio: Portfolio;
  isActive: boolean;
  screenWidth: number;
  onOpenCashEdit: () => void;
  onOpenSnapshots: () => void;
  onActivate: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const allHoldings = useQuery(Holding).filtered(
    `portfolioId == oid(${portfolio._id.toHexString()}) AND isDisabled == false`,
  );
  const totalMarketValue = allHoldings.reduce((s, h) => s + h.shares * h.currentPrice, 0);
  const cash = Math.max(portfolio.currentCapital, 0);
  const totalAssets = totalMarketValue + cash;
  const nav = portfolio.initialCapital > 0 ? totalAssets / portfolio.initialCapital : 1;
  const pnlAmt = totalAssets - portfolio.initialCapital;
  const pnlPct = portfolio.initialCapital > 0 ? (pnlAmt / portfolio.initialCapital) * 100 : 0;

  const Colors = useColors();
  const cardStyles = makeCardStyles(Colors);

  const fmt = (v: number) =>
    v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <View style={{ width: screenWidth, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm }}>
      <View style={[cardStyles.card, isActive && cardStyles.cardActive]}>
        {/* 头部：名称 + 草稿标签 */}
        <View style={cardStyles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={cardStyles.cardName} numberOfLines={1}>{portfolio.name}</Text>
            <Text style={cardStyles.cardMeta}>{portfolio.market} · {portfolio.currency}</Text>
          </View>
          {portfolio.isDraft && (
            <View style={cardStyles.draftBadge}>
              <Text style={cardStyles.draftText}>草稿</Text>
            </View>
          )}
        </View>

        {/* 总资产 */}
        <Text style={cardStyles.totalLabel}>总资产</Text>
        <Text style={cardStyles.totalValue}>{fmt(totalAssets)}</Text>

        {/* 净值 + 浮盈亏 */}
        <View style={cardStyles.statsRow}>
          <View>
            <Text style={cardStyles.statLabel}>净值</Text>
            <Text style={[cardStyles.statValue, { color: nav >= 1 ? Colors.profit : Colors.loss }]}>
              {nav.toFixed(4)}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={cardStyles.statLabel}>浮盈亏</Text>
            <Text style={[cardStyles.statValue, { color: pnlAmt >= 0 ? Colors.profit : Colors.loss }]}>
              {pnlAmt >= 0 ? '+' : ''}{fmt(pnlAmt)}  {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
            </Text>
          </View>
        </View>

        {/* 操作按钮 */}
        <View style={cardStyles.cardActions}>
          {portfolio.isDraft && (
            <TouchableOpacity style={[cardStyles.actionBtn, cardStyles.activateBtn]} onPress={onActivate}>
              <Text style={[cardStyles.actionBtnText, { color: Colors.primary }]}>激活</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[cardStyles.actionBtn, cardStyles.cashEditBtn]} onPress={onOpenCashEdit}>
            <Text style={[cardStyles.actionBtnText, cardStyles.cashEditBtnText]}>💰 现金</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[cardStyles.actionBtn, cardStyles.snapshotBtn]} onPress={onOpenSnapshots}>
            <Text style={[cardStyles.actionBtnText, cardStyles.snapshotBtnText]}>📎 快照</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[cardStyles.actionBtn, cardStyles.archiveBtn]} onPress={onArchive}>
            <Text style={[cardStyles.actionBtnText, cardStyles.archiveBtnText]}>归档</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[cardStyles.actionBtn, cardStyles.deleteBtn]} onPress={onDelete}>
            <Text style={[cardStyles.actionBtnText, cardStyles.deleteBtnText]}>删除</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
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
  const Colors = useColors();
  const styles = makeStyles(Colors);
  const txStyles = makeTxStyles(Colors);

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
  const Colors = useColors();
  return (
    <View style={{ alignItems: 'center', marginRight: Spacing.md }}>
      <Text style={{ fontSize: FontSize.xs, color: Colors.textTertiary }}>{label}</Text>
      <Text style={{ fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: color ?? Colors.textPrimary }}>
        {sign && value >= 0 ? '+' : ''}{value.toFixed(1)}%
      </Text>
    </View>
  );
}

function makeStyles(C: ThemeColors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  segmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  segmentBar: {
    flex: 1,
    flexDirection: 'row',
  },
  addBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: C.primary,
    borderRadius: Radius.sm,
    marginRight: Spacing.sm,
  },
  importBtnSmall: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: C.surfaceElevated,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: C.border,
    marginRight: Spacing.sm,
  },
  addBtnText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    color: C.textPrimary,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  segmentText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: C.textTertiary,
  },
  trancheHeader: {
    flexDirection: 'row',
    backgroundColor: C.surfaceElevated,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  trancheStatItem: { flex: 1, alignItems: 'center' },
  trancheStatLabel: { fontSize: FontSize.xs, color: C.textTertiary },
  trancheStatValue: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: C.textPrimary },
  list: { padding: Spacing.sm },
  holdingCell: {
    backgroundColor: C.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: C.border,
  },
  holdingTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.sm },
  ticker: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: C.textPrimary },
  holdingName: { fontSize: FontSize.xs, color: C.textTertiary },
  holdingRight: { alignItems: 'flex-end' },
  marketValue: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: C.textPrimary },
  pnl: { fontSize: FontSize.xs },
  weightRow: { flexDirection: 'row', alignItems: 'center' },
  shares: { marginLeft: 'auto', fontSize: FontSize.xs, color: C.textTertiary },
  priceRow: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.xs, gap: Spacing.sm },
  currentPrice: { fontSize: FontSize.xs, color: C.textSecondary },
  priceTime: { fontSize: FontSize.xs, color: C.textTertiary },
  empty: { alignItems: 'center', paddingTop: Spacing.xxl },
  emptyText: { color: C.textTertiary, fontSize: FontSize.md },

  // Modal
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  overlayCentered: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  modalCardCenter: {
    backgroundColor: C.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: C.border,
  },
  modalCard: {
    backgroundColor: C.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: C.border,
  },
  modalTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: C.textPrimary,
    marginBottom: Spacing.md,
  },
  inputLabel: {
    fontSize: FontSize.sm,
    color: C.textSecondary,
    marginBottom: Spacing.xs,
    marginTop: Spacing.sm,
  },
  input: {
    backgroundColor: C.surfaceElevated,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: C.textPrimary,
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
    backgroundColor: C.surfaceElevated,
    borderWidth: 1,
    borderColor: C.border,
  },
  confirmBtn: { backgroundColor: C.primary },
  modalBtnText: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
    color: C.textPrimary,
  },

  // ── 快照 Modal ──
  snapshotOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  snapshotSheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    maxHeight: '75%',
    paddingBottom: Spacing.xl,
  },
  snapshotHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  snapshotTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: C.textPrimary },
  snapshotClose: { fontSize: FontSize.lg, color: C.textTertiary, paddingHorizontal: Spacing.sm },
  snapshotList: { flexGrow: 1, flexShrink: 1, minHeight: 80, paddingHorizontal: Spacing.lg },
  snapshotEmpty: {
    color: C.textTertiary,
    fontSize: FontSize.sm,
    textAlign: 'center',
    paddingVertical: Spacing.xl,
  },
  snapshotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: Spacing.sm,
  },
  snapshotRowInfo: { flex: 1 },
  snapshotLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: C.textPrimary },
  snapshotDate: { fontSize: FontSize.xs, color: C.textTertiary, marginTop: 2 },
  restoreBtn: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    backgroundColor: 'rgba(10,132,255,0.12)',
    borderRadius: Radius.sm,
  },
  restoreBtnText: { fontSize: FontSize.xs, color: '#0A84FF', fontWeight: FontWeight.medium },
  snapshotDelBtn: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    backgroundColor: 'rgba(255,59,48,0.10)',
    borderRadius: Radius.sm,
  },
  snapshotDelBtnText: { fontSize: FontSize.xs, color: '#FF3B30', fontWeight: FontWeight.medium },
  snapshotSaveArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  snapshotInput: {
    flex: 1,
    backgroundColor: C.surfaceElevated,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    color: C.textPrimary,
    fontSize: FontSize.sm,
    borderWidth: 1,
    borderColor: C.border,
  },
  saveSnapshotBtn: {
    backgroundColor: C.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
  },
  saveSnapshotBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: C.textPrimary },

  // ── 卡片 Swiper 区域 ──
  swiperSection: {
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.background,
  },
  emptyCardWrap: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  emptyCardText: { color: C.textTertiary, fontSize: FontSize.md, marginBottom: Spacing.md },
  createFirstBtn: {
    backgroundColor: C.primary,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
  },
  createFirstBtnText: { color: C.textPrimary, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },
  addPortfolioBtn: {
    position: 'absolute',
    top: Spacing.sm + 4,
    right: Spacing.md + 4,
    backgroundColor: C.surfaceElevated,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    zIndex: 10,
  },
  addPortfolioBtnText: { fontSize: FontSize.xs, color: C.textPrimary, fontWeight: FontWeight.medium },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: Spacing.xs,
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.border,
  },
  dotActive: {
    backgroundColor: C.primary,
    width: 14,
  },
}); }

function makeTxStyles(C: ThemeColors) { return StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.md },
  holdingMeta: { fontSize: FontSize.xs, color: C.textTertiary, marginTop: 2 },
  closeBtn: { fontSize: FontSize.lg, color: C.textTertiary, padding: Spacing.xs },
  emptyTx: { color: C.textTertiary, fontSize: FontSize.sm, textAlign: 'center', paddingVertical: Spacing.md },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
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
  txShares: { fontSize: FontSize.sm, color: C.textPrimary },
  txDate: { fontSize: FontSize.xs, color: C.textTertiary },
  txAmount: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: C.textPrimary },
  txFee: { fontSize: FontSize.xs, color: C.textTertiary },
  addTxBtn: {
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: C.primary,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  addTxText: { color: C.primary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  formBox: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    backgroundColor: C.surfaceElevated,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: C.border,
  },
  formTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: C.textPrimary, marginBottom: Spacing.sm },
  typeRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  typeBtn: {
    flex: 1,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.sm,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
  },
  typeBtnText: { fontSize: FontSize.xs, color: C.textSecondary },
}); }

// ─── 组合卡片样式 ─────────────────────────────────────────
function makeCardStyles(C: ThemeColors) { return StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: C.border,
  },
  cardActive: { borderColor: C.primary, borderWidth: 2 },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.xs,
  },
  cardName: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: C.textPrimary },
  cardMeta: { fontSize: FontSize.xs, color: C.textTertiary, marginTop: 2 },
  draftBadge: {
    backgroundColor: C.surfaceElevated,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.sm,
  },
  draftText: { fontSize: FontSize.xs, color: C.textTertiary },
  totalLabel: { fontSize: FontSize.xs, color: C.textTertiary, marginTop: Spacing.xs },
  totalValue: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: C.textPrimary, marginBottom: Spacing.xs },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: Spacing.sm,
  },
  statLabel: { fontSize: FontSize.xs, color: C.textTertiary },
  statValue: { fontSize: FontSize.md, fontWeight: FontWeight.medium, color: C.textPrimary },
  cardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  actionBtn: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.sm,
    backgroundColor: C.primary,
  },
  actionBtnText: { fontSize: FontSize.xs, fontWeight: FontWeight.medium, color: C.textPrimary },
  activateBtn: { backgroundColor: 'rgba(10,132,255,0.12)' },
  cashEditBtn: { backgroundColor: 'rgba(52,199,89,0.15)' },
  cashEditBtnText: { color: '#34C759' },
  snapshotBtn: { backgroundColor: 'rgba(255,204,0,0.15)' },
  snapshotBtnText: { color: '#FFCC00' },
  archiveBtn: { backgroundColor: C.surfaceElevated },
  archiveBtnText: { color: C.textTertiary },
  deleteBtn: { backgroundColor: 'rgba(255,59,48,0.15)' },
  deleteBtnText: { color: '#FF3B30' },
}); }
