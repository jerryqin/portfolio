import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { useQuery } from '@realm/react';
import Realm from 'realm';
import { ThemeColors, Spacing, FontSize, FontWeight, Radius } from '../../theme';
import { useColors } from '../../theme/useColors';
import { parseCSV, ParsedRow, CashAdjustRow } from '../../utils/csvImport';
import { usePortfolioStore } from '../../store/portfolioStore';
import { Holding } from '../../database/schema';

interface Props {
  visible: boolean;
  portfolioId: string;
  onClose: () => void;
  onImported: () => void;
}

type Step = 'idle' | 'parsing' | 'preview' | 'importing';

interface Summary {
  matchedRows: ParsedRow[];      // 组合内标的的交易
  matchedTickers: string[];
  outsideTickers: string[];      // CSV 中有但组合里没有的标的
  skippedByFormat: number;       // 无现金影响的空行等
  cashRows: CashAdjustRow[];     // 期权溢价、利息等现金调整行
}

export default function ImportModal({ visible, portfolioId, onClose, onImported }: Props) {
  const Colors = useColors();
  const styles = makeStyles(Colors);
  const { batchImportTransactions } = usePortfolioStore();
  const [step, setStep] = useState<Step>('idle');
  const [summary, setSummary] = useState<Summary | null>(null);

  // 读取当前组合的持仓 ticker 集合
  const holdings = useQuery(Holding).filtered(
    `portfolioId == oid(${portfolioId}) AND isDisabled == false`,
  );
  const portfolioTickers = new Set(Array.from(holdings).map(h => h.ticker));

  const handlePickFile = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/plain', 'public.comma-separated-values-text', '*/*'],
        copyToCacheDirectory: true,
      });

      if (picked.canceled) return;

      setStep('parsing');

      const fileUri = picked.assets[0].uri;
      const content = await FileSystem.readAsStringAsync(fileUri);
      const parsed = parseCSV(content);

      // 按组合持仓过滤
      const matchedRows = parsed.rows.filter(r => portfolioTickers.has(r.ticker));
      const allCsvTickers = [...new Set(parsed.rows.map(r => r.ticker))];
      const matchedTickers = [...new Set(matchedRows.map(r => r.ticker))];
      const outsideTickers = allCsvTickers.filter(t => !portfolioTickers.has(t));

      // 组合外标的（如已平仓的 AMKR 等）：把每笔买卖折算成现金流并入 cashRows
      // 买入→现金减少，卖出/股息→现金增加，确保其净资产影响被正确计入
      const outsideCashRows: import('../../utils/csvImport').CashAdjustRow[] = [];
      for (const row of parsed.rows) {
        if (portfolioTickers.has(row.ticker)) continue;
        let cashDelta = 0;
        if (row.type === 'buy') cashDelta = -(row.shares * row.price);
        else if (row.type === 'sell') cashDelta = row.shares * row.price;
        else if (row.type === 'dividend') cashDelta = row.amount;
        if (cashDelta !== 0) {
          outsideCashRows.push({
            date: row.date,
            amount: cashDelta,
            notes: `已平仓 ${row.ticker} ${row.type === 'buy' ? '买入' : row.type === 'sell' ? '卖出' : '股息'}`,
          });
        }
      }
      const allCashRows = [...parsed.cashRows, ...outsideCashRows];

      if (matchedRows.length === 0 && allCashRows.length === 0) {
        Alert.alert(
          '无可导入记录',
          `CSV 中的标的（${allCsvTickers.join('、')}）均不在当前组合中\n请先在持仓明细中添加相应标的`,
        );
        setStep('idle');
        return;
      }

      setSummary({ matchedRows, matchedTickers, outsideTickers, skippedByFormat: parsed.skipped, cashRows: allCashRows });
      setStep('preview');
    } catch (e: any) {
      Alert.alert('读取失败', e?.message ?? '请确认文件格式为 UTF-8 CSV');
      setStep('idle');
    }
  };

  const handleConfirmImport = () => {
    if (!summary) return;
    setStep('importing');
    try {
      const { imported } = batchImportTransactions(portfolioId, summary.matchedRows, summary.cashRows);
      const cashAdj = summary.cashRows.length > 0 ? `\n另含 ${summary.cashRows.length} 条现金调整（期权/利息）` : '';
      Alert.alert(
        '导入成功',
        `已导入 ${imported} 条交易记录${cashAdj}`,
        [{ text: '确定', onPress: () => { resetAndClose(); onImported(); } }],
      );
    } catch (e: any) {
      Alert.alert('导入失败', e?.message ?? '请重试');
      setStep('preview');
    }
  };

  const resetAndClose = () => {
    setStep('idle');
    setSummary(null);
    onClose();
  };

  const TYPE_LABEL: Record<string, string> = {
    buy: '买入',
    sell: '卖出',
    dividend: '分红',
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={resetAndClose}>
      <View style={styles.container}>
        {/* 顶栏 */}
        <View style={styles.header}>
          <TouchableOpacity onPress={resetAndClose}>
            <Text style={styles.cancelBtn}>取消</Text>
          </TouchableOpacity>
          <Text style={styles.title}>导入交易记录</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* 空闲 / 解析中 */}
        {(step === 'idle' || step === 'parsing') && (
          <View style={styles.idleArea}>
            <Text style={styles.hint}>
              仅导入当前组合已有持仓的交易记录{'\n'}
              支持券商导出的 CSV 格式
            </Text>
            <Text style={styles.subHint}>
              组合外标的、期权、利息等自动跳过
            </Text>
            {step === 'parsing' ? (
              <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: Spacing.xl }} />
            ) : (
              <TouchableOpacity style={styles.pickBtn} onPress={handlePickFile}>
                <Text style={styles.pickBtnText}>选择 CSV 文件</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* 预览 */}
        {step === 'preview' && summary && (
          <>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {/* 匹配统计 */}
              <View style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>解析结果</Text>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>将导入</Text>
                  <Text style={[styles.summaryValue, { color: Colors.profit }]}>
                    {summary.matchedRows.length} 条
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>匹配标的</Text>
                  <Text style={styles.summaryValue}>{summary.matchedTickers.length} 只</Text>
                </View>
                <Text style={styles.tickerList}>{summary.matchedTickers.join('  ·  ')}</Text>
              </View>

              {/* 跳过统计 */}
              {(summary.outsideTickers.length > 0 || summary.skippedByFormat > 0 || summary.cashRows.length > 0) && (
                <View style={[styles.summaryCard, styles.skipCard]}>
                  <Text style={styles.summaryTitle}>现金调整</Text>
                  {summary.cashRows.length > 0 && (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>已平仓/期权/利息等</Text>
                      <Text style={[styles.summaryValue, { color: Colors.profit }]}>{summary.cashRows.length} 笔 ✓ 计入现金</Text>
                    </View>
                  )}
                  {summary.outsideTickers.length > 0 && (
                    <Text style={styles.skipTickerList}>{summary.outsideTickers.join('  ·  ')}</Text>
                  )}
                  {summary.skippedByFormat > 0 && (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>无效行</Text>
                      <Text style={styles.summaryValue}>{summary.skippedByFormat} 行</Text>
                    </View>
                  )}
                </View>
              )}

              {/* 预览前 20 条 */}
              <Text style={styles.previewTitle}>交易预览（前 20 条）</Text>
              {summary.matchedRows.slice(0, 20).map((row, idx) => (
                <View key={idx} style={styles.previewRow}>
                  <Text style={styles.previewDate}>
                    {row.date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
                  </Text>
                  <Text style={[
                    styles.previewType,
                    { color: row.type === 'buy' ? Colors.profit : row.type === 'sell' ? Colors.loss : Colors.neutral },
                  ]}>
                    {TYPE_LABEL[row.type] ?? row.type}
                  </Text>
                  <Text style={styles.previewTicker}>{row.ticker}</Text>
                  <Text style={styles.previewShares}>{row.shares}</Text>
                  <Text style={styles.previewPrice}>@{row.price.toFixed(2)}</Text>
                </View>
              ))}
              {summary.matchedRows.length > 20 && (
                <Text style={styles.moreHint}>…还有 {summary.matchedRows.length - 20} 条</Text>
              )}
            </ScrollView>

            <TouchableOpacity style={styles.importBtn} onPress={handleConfirmImport}>
              <Text style={styles.importBtnText}>确认导入 {summary.matchedRows.length} 条</Text>
            </TouchableOpacity>
          </>
        )}

        {/* 导入中 */}
        {step === 'importing' && (
          <View style={styles.idleArea}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.hint}>正在写入数据库…</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

function makeStyles(C: ThemeColors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  cancelBtn: { color: C.textSecondary, fontSize: FontSize.md },
  title: { color: C.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  idleArea: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  hint: { color: C.textSecondary, fontSize: FontSize.sm, textAlign: 'center', lineHeight: 22 },
  subHint: { color: C.textTertiary, fontSize: FontSize.xs, textAlign: 'center', marginTop: Spacing.xs },
  pickBtn: {
    marginTop: Spacing.xl,
    backgroundColor: C.primary,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
  },
  pickBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  summaryCard: {
    margin: Spacing.md,
    marginBottom: 0,
    backgroundColor: C.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  skipCard: {
    backgroundColor: C.surfaceElevated,
  },
  summaryTitle: { color: C.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, marginBottom: Spacing.sm },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  summaryLabel: { color: C.textSecondary, fontSize: FontSize.sm },
  summaryValue: { color: C.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  tickerList: { color: C.primary, fontSize: FontSize.xs, marginTop: Spacing.xs, lineHeight: 20 },
  skipTickerList: { color: C.textTertiary, fontSize: FontSize.xs, marginTop: Spacing.xs, lineHeight: 20 },
  previewTitle: {
    color: C.textTertiary,
    fontSize: FontSize.xs,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.md,
    marginBottom: 4,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  previewDate: { color: C.textTertiary, fontSize: FontSize.xs, width: 44 },
  previewType: { fontSize: FontSize.xs, width: 32 },
  previewTicker: { color: C.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.medium, flex: 1 },
  previewShares: { color: C.textSecondary, fontSize: FontSize.xs, width: 50, textAlign: 'right' },
  previewPrice: { color: C.textTertiary, fontSize: FontSize.xs, width: 70, textAlign: 'right' },
  moreHint: { color: C.textTertiary, fontSize: FontSize.xs, textAlign: 'center', paddingVertical: Spacing.sm },
  importBtn: {
    margin: Spacing.md,
    backgroundColor: C.primary,
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'center',
  },
  importBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.semibold },
}); }

