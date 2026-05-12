import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  InteractionManager,
  SafeAreaView,
} from 'react-native';
import { useQuery, useRealm } from '@realm/react';
import Realm from 'realm';
import { Colors, Spacing, FontSize, FontWeight, Radius } from '../../theme';
import { Portfolio, PortfolioSnapshot } from '../../database/schema';
import { usePortfolioStore } from '../../store/portfolioStore';

export default function PortfoliosScreen() {
  const realm = useRealm();
  const { activePortfolioId, setActivePortfolioId, activatePortfolio, createPortfolio, deletePortfolio, saveSnapshot, restoreSnapshot, deleteSnapshot, refreshPrices } =
    usePortfolioStore();

  const [modalVisible, setModalVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCapital, setNewCapital] = useState('');
  const [newCash, setNewCash] = useState('');

  // 编辑现金 Modal
  const [cashModal, setCashModal] = useState(false);
  const [cashTarget, setCashTarget] = useState<Portfolio | null>(null);
  const [editCashValue, setEditCashValue] = useState('');

  // 快照 Modal
  const [snapshotModal, setSnapshotModal] = useState(false);
  const [snapshotTarget, setSnapshotTarget] = useState<Portfolio | null>(null);
  const [newSnapshotLabel, setNewSnapshotLabel] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);

  const allSnapshots = useQuery(PortfolioSnapshot).sorted('createdAt', true);

  const portfolios = useQuery(Portfolio)
    .filtered('isArchived == false')
    .sorted('createdAt', true);

  const handleCreate = () => {
    setNewName('');
    setNewCapital('');
    setNewCash('');
    setModalVisible(true);
  };

  const handleConfirmCreate = () => {
    const name = newName.trim() || '新组合';
    const capital = parseFloat(newCapital) || 0;
    // currentCapital 直接设为用户输入的现金余额，不等于总资产
    const cash = parseFloat(newCash);
    const initialCash = isNaN(cash) ? 0 : cash;
    const id = createPortfolio({ name, market: 'US', currency: 'USD', initialCapital: capital, currentCapital: initialCash });
    setActivePortfolioId(id);
    setModalVisible(false);
  };

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
    Alert.alert('已保存', `快照「${label}」保存成功，可在列表中点击「恢复」一键还原。`);
  };
  const handleRestoreSnapshot = (snapshotId: string) => {
    Alert.alert('恢复快照', '确认恢复？当前持仓将被覆盖。', [
      { text: '取消', style: 'cancel' },
      {
        text: '恢复',
        style: 'destructive',
        onPress: () => {
          const targetId = snapshotTarget?._id.toHexString() ?? '';
          // 先关闭 Modal，等动画完成后再执行写操作
          setSnapshotModal(false);
          setIsRestoring(true);
          InteractionManager.runAfterInteractions(() => {
            try {
              restoreSnapshot(snapshotId);
              // 恢复后自动刷新行情，修正持仓市值显示
              if (targetId) refreshPrices(targetId);
            } finally {
              setIsRestoring(false);
            }
          });
        },
      },
    ]);
  };
  const handleDeleteSnapshot = (snapshotId: string) => {
    Alert.alert('删除快照', '确认删除此快照？', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => deleteSnapshot(snapshotId) },
    ]);
  };

  const handleDelete = (portfolio: Portfolio) => {
    Alert.alert(
      '删除组合',
      `确认删除「${portfolio.name}」？此操作不可恢复，将同时删除全部持仓和交易流水。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => deletePortfolio(portfolio._id.toHexString()),
        },
      ],
    );
  };

  const handleArchive = (portfolio: Portfolio) => {
    Alert.alert('归档组合', `确认归档「${portfolio.name}」？归档后不参与统计。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '归档',
        style: 'destructive',
        onPress: () => {
          realm.write(() => {
            portfolio.isArchived = true;
            portfolio.updatedAt = new Date();
          });
        },
      },
    ]);
  };

  const handleActivate = (portfolio: Portfolio) => {
    const id = portfolio._id.toHexString();
    const result = activatePortfolio(id);
    if (!result.ok) {
      Alert.alert('无法激活', result.error);
    } else {
      setActivePortfolioId(id);
    }
  };

  const renderItem = ({ item }: { item: Portfolio }) => {
    const isActive = item._id.toHexString() === activePortfolioId;
    return (
      <TouchableOpacity
        style={[styles.card, isActive && styles.cardActive]}
        onPress={() => setActivePortfolioId(item._id.toHexString())}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.cardName}>{item.name}</Text>
            <Text style={styles.cardMeta}>
              {item.market} · {item.currency} · {item.benchmarkIndex}
            </Text>
          </View>
          {item.isDraft && (
            <View style={styles.draftBadge}>
              <Text style={styles.draftText}>草稿</Text>
            </View>
          )}
        </View>

        <View style={styles.cardStats}>
          <View>
            <Text style={styles.statLabel}>初始总资产</Text>
            <Text style={styles.statValue}>
              {item.initialCapital.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.statLabel}>现金余额</Text>
            <Text style={styles.statValue}>
              {item.currentCapital.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </Text>
          </View>
        </View>

        <Text style={[styles.cardDate, { textAlign: 'right', marginBottom: Spacing.sm }]}>
          {item.createdAt.toLocaleDateString('zh-CN')}
        </Text>

        <View style={styles.cardActions}>
          {item.isDraft && (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => handleActivate(item)}>
              <Text style={styles.actionBtnText}>激活</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.actionBtn, styles.cashEditBtn]}
            onPress={() => handleOpenCashEdit(item)}>
            <Text style={[styles.actionBtnText, styles.cashEditBtnText]}>💰 现金</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.snapshotBtn]}
            onPress={() => handleOpenSnapshots(item)}>
            <Text style={[styles.actionBtnText, styles.snapshotBtnText]}>📎 快照</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.archiveBtn]}
            onPress={() => handleArchive(item)}>
            <Text style={[styles.actionBtnText, styles.archiveBtnText]}>归档</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.deleteBtn]}
            onPress={() => handleDelete(item)}>
            <Text style={[styles.actionBtnText, styles.deleteBtnText]}>删除</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>我的组合</Text>
        <TouchableOpacity style={styles.createBtn} onPress={handleCreate}>
          <Text style={styles.createBtnText}>+ 新建</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={Array.from(portfolios)}
        keyExtractor={item => item._id.toHexString()}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>还没有组合，点击「新建」开始</Text>
          </View>
        }
      />

      {/* 新建组合 Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>新建组合</Text>

            <Text style={styles.inputLabel}>组合名称</Text>
            <TextInput
              style={styles.input}
              placeholder="例如：成长股组合"
              placeholderTextColor={Colors.textTertiary}
              value={newName}
              onChangeText={setNewName}
              returnKeyType="next"
              autoFocus
            />

            <Text style={styles.inputLabel}>初始总资产（USD，Statement 页面的总市值）</Text>
            <TextInput
              style={styles.input}
              placeholder="0.00"
              placeholderTextColor={Colors.textTertiary}
              value={newCapital}
              onChangeText={setNewCapital}
              keyboardType="decimal-pad"
              returnKeyType="next"
            />

            <Text style={styles.inputLabel}>初始现金余额（USD，Statement 页面的 Cash 金额）</Text>
            <TextInput
              style={styles.input}
              placeholder="0.00"
              placeholderTextColor={Colors.textTertiary}
              value={newCash}
              onChangeText={setNewCash}
              keyboardType="decimal-pad"
              returnKeyType="done"
              onSubmitEditing={handleConfirmCreate}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setModalVisible(false)}>
                <Text style={[styles.modalBtnText, { color: Colors.textSecondary }]}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.confirmBtn]}
                onPress={handleConfirmCreate}>
                <Text style={styles.modalBtnText}>创建</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 编辑现金余额 Modal */}
      <Modal
        visible={cashModal}
        transparent
        animationType="fade"
        onRequestClose={() => setCashModal(false)}>
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>编辑现金余额</Text>
            <Text style={[styles.inputLabel, { marginBottom: Spacing.sm }]}>
              直接输入账户当前的现金余额（USD）
            </Text>
            <TextInput
              style={styles.input}
              placeholder="0.00"
              placeholderTextColor={Colors.textTertiary}
              value={editCashValue}
              onChangeText={setEditCashValue}
              keyboardType="decimal-pad"
              returnKeyType="done"
              onSubmitEditing={handleConfirmCashEdit}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setCashModal(false)}>
                <Text style={[styles.modalBtnText, { color: Colors.textSecondary }]}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.confirmBtn]}
                onPress={handleConfirmCashEdit}>
                <Text style={styles.modalBtnText}>确认</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 快照管理 Modal */}
      <Modal
        visible={snapshotModal}
        transparent
        animationType="slide"
        onRequestClose={() => setSnapshotModal(false)}>
        <KeyboardAvoidingView
          style={styles.snapshotOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setSnapshotModal(false)} />
          <View style={styles.snapshotSheet}>
            <View style={styles.snapshotHeader}>
              <Text style={styles.snapshotTitle}>
                快照 · {snapshotTarget?.name ?? ''}
              </Text>
              <TouchableOpacity onPress={() => setSnapshotModal(false)}>
                <Text style={styles.snapshotClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* 快照列表 */}
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
                    <TouchableOpacity
                      style={styles.snapshotDelBtn}
                      onPress={() => handleDeleteSnapshot(s._id.toHexString())}>
                      <Text style={styles.snapshotDelBtnText}>删除</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              {Array.from(allSnapshots).filter(
                s => s.portfolioId.toHexString() === snapshotTarget?._id.toHexString(),
              ).length === 0 && (
                <Text style={styles.snapshotEmpty}>暂无快照，点击下方「保存快照」创建</Text>
              )}
            </ScrollView>

            {/* 保存新快照 */}
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
    </SafeAreaView>
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
  title: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  createBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
  },
  createBtnText: { color: Colors.textPrimary, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },
  list: { padding: Spacing.md, gap: Spacing.sm },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardActive: { borderColor: Colors.primary },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.sm },
  cardName: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.textPrimary },
  cardMeta: { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: 2 },
  draftBadge: {
    backgroundColor: Colors.surfaceElevated,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.sm,
  },
  draftText: { fontSize: FontSize.xs, color: Colors.textTertiary },
  cardStats: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: Spacing.sm },
  statLabel: { fontSize: FontSize.xs, color: Colors.textTertiary },
  statValue: { fontSize: FontSize.md, fontWeight: FontWeight.medium, color: Colors.textPrimary },
  cardDate: { fontSize: FontSize.xs, color: Colors.textTertiary },
  cardActions: { flexDirection: 'row', gap: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border },
  actionBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primary,
  },
  actionBtnText: { fontSize: FontSize.xs, fontWeight: FontWeight.medium, color: Colors.textPrimary },
  snapshotBtn: { backgroundColor: 'rgba(255,204,0,0.15)' },
  snapshotBtnText: { color: '#FFCC00' },
  cashEditBtn: { backgroundColor: 'rgba(52,199,89,0.15)' },
  cashEditBtnText: { color: '#34C759' },
  archiveBtn: { backgroundColor: Colors.surfaceElevated },
  archiveBtnText: { color: Colors.textTertiary },
  deleteBtn: { backgroundColor: 'rgba(255,59,48,0.15)' },
  deleteBtnText: { color: '#FF3B30' },
  empty: { alignItems: 'center', paddingTop: Spacing.xxl },
  emptyText: { color: Colors.textTertiary, fontSize: FontSize.md },

  // 新建 Modal
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
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
  confirmBtn: {
    backgroundColor: Colors.primary,
  },
  modalBtnText: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
    color: Colors.textPrimary,
  },

  // 快照 Modal
  snapshotOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  snapshotSheet: {
    backgroundColor: Colors.surface,
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
    borderBottomColor: Colors.border,
  },
  snapshotTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textPrimary },
  snapshotClose: { fontSize: FontSize.lg, color: Colors.textTertiary, paddingHorizontal: Spacing.sm },
  snapshotList: { flexGrow: 1, flexShrink: 1, minHeight: 80, paddingHorizontal: Spacing.lg },
  snapshotEmpty: {
    color: Colors.textTertiary,
    fontSize: FontSize.sm,
    textAlign: 'center',
    paddingVertical: Spacing.xl,
  },
  snapshotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.sm,
  },
  snapshotRowInfo: { flex: 1 },
  snapshotLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.textPrimary },
  snapshotDate: { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: 2 },
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
    borderTopColor: Colors.border,
  },
  snapshotInput: {
    flex: 1,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    color: Colors.textPrimary,
    fontSize: FontSize.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  saveSnapshotBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
  },
  saveSnapshotBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textPrimary },
});
