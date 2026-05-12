import React, { useState } from 'react';
import {
  View,
  Text,
  Switch,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Share,
  SafeAreaView,
} from 'react-native';
import DocumentPicker from 'react-native-document-picker';
import { Spacing, FontSize, FontWeight, Radius, ThemeColors } from '../../theme';
import { useColors } from '../../theme/useColors';
import { useThemeStore } from '../../store/themeStore';
import { usePortfolioStore } from '../../store/portfolioStore';

const APP_CONFIG = require('../../../app.json');
const APP_VERSION: string = APP_CONFIG?.expo?.version ?? '0.0.0';
const APP_BUILD: string | undefined = APP_CONFIG?.expo?.ios?.buildNumber;
const VERSION_TEXT = APP_BUILD ? `${APP_VERSION} (${APP_BUILD})` : APP_VERSION;

export default function SettingsScreen() {
  const Colors = useColors();
  const { isDark, toggleTheme } = useThemeStore();
  const { exportAllData, importAllData, setActivePortfolioId } = usePortfolioStore();
  const styles = makeStyles(Colors);
  const [busy, setBusy] = useState(false);

  // ── 导出 ───────────────────────────────────────────────
  const handleExport = async () => {
    setBusy(true);
    try {
      const json = exportAllData();
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const filename = `portfolio_backup_${date}.json`;
      await Share.share({ message: json, title: filename });
    } catch (e: any) {
      Alert.alert('导出失败', e?.message ?? '未知错误');
    } finally {
      setBusy(false);
    }
  };

  // ── 导入 ───────────────────────────────────────────────
  const handleImport = async () => {
    try {
      const results = await DocumentPicker.pick({
        type: [DocumentPicker.types.allFiles],
        copyTo: 'cachesDirectory',
      });

      setBusy(true);

      const fileUri = results[0].fileCopyUri ?? results[0].uri;
      const json = await fetch(decodeURIComponent(fileUri)).then(r => r.text());
      const backup = JSON.parse(json);

      if (!backup || backup.version !== 1 || !Array.isArray(backup.portfolios)) {
        Alert.alert('格式错误', '所选文件不是有效的备份文件');
        setBusy(false);
        return;
      }

      const count = backup.portfolios.length;
      const exportedAt = backup.exportedAt
        ? new Date(backup.exportedAt).toLocaleString('zh-CN')
        : '未知';

      Alert.alert(
        '确认恢复',
        `备份时间：${exportedAt}\n共 ${count} 个组合\n\n⚠️ 将覆盖所有现有数据，此操作不可撤销。`,
        [
          { text: '取消', style: 'cancel', onPress: () => setBusy(false) },
          {
            text: '恢复',
            style: 'destructive',
            onPress: () => {
              try {
                importAllData(json);
                // 重置活跃组合指向第一个
                if (backup.portfolios.length > 0) {
                  setActivePortfolioId(backup.portfolios[0]._id);
                }
                Alert.alert('恢复成功', `已还原 ${count} 个组合的全部数据`);
              } catch (e: any) {
                Alert.alert('恢复失败', e?.message ?? '数据写入错误');
              } finally {
                setBusy(false);
              }
            },
          },
        ],
      );
    } catch (e: any) {
      Alert.alert('读取失败', e?.message ?? '请选择有效的备份文件');
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.pageTitle}>设置</Text>
      <ScrollView contentContainerStyle={styles.content}>

        {/* 外观 */}
        <Text style={styles.groupHeader}>外观</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowIcon}>🌙</Text>
              <View>
                <Text style={styles.rowLabel}>深色模式</Text>
                <Text style={styles.rowSub}>
                  {isDark ? '当前：深色' : '当前：浅色'}
                </Text>
              </View>
            </View>
            <Switch
              value={isDark}
              onValueChange={toggleTheme}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor={Colors.textPrimary}
            />
          </View>
        </View>

        {/* 数据备份 */}
        <Text style={styles.groupHeader}>数据备份</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.row} onPress={handleExport} disabled={busy}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowIcon}>📤</Text>
              <View>
                <Text style={styles.rowLabel}>导出全部数据</Text>
                <Text style={styles.rowSub}>组合、持仓、交易、净值历史</Text>
              </View>
            </View>
            {busy ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <Text style={styles.rowChevron}>›</Text>
            )}
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.row} onPress={handleImport} disabled={busy}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowIcon}>📥</Text>
              <View>
                <Text style={styles.rowLabel}>从备份恢复</Text>
                <Text style={styles.rowSub}>选择 .json 备份文件一键还原</Text>
              </View>
            </View>
            {busy ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <Text style={styles.rowChevron}>›</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* 关于 */}
        <Text style={styles.groupHeader}>关于</Text>
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>版本</Text>
            <Text style={styles.infoValue}>{VERSION_TEXT}</Text>
          </View>
          <View style={[styles.infoRow, styles.noBorder]}>
            <Text style={styles.infoLabel}>数据存储</Text>
            <Text style={styles.infoValue}>本地 Realm</Text>
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(C: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: C.background },
    pageTitle: {
      fontSize: FontSize.xl,
      fontWeight: FontWeight.bold,
      color: C.textPrimary,
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.xs,
    },
    content: { padding: Spacing.md },
    groupHeader: {
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
      color: C.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: Spacing.xs,
      marginTop: Spacing.md,
    },
    card: {
      backgroundColor: C.surface,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: C.border,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.md,
    },
    rowLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    rowIcon: { fontSize: 20 },
    rowLabel: { fontSize: FontSize.md, color: C.textPrimary, fontWeight: FontWeight.medium },
    rowSub: { fontSize: FontSize.sm, color: C.textTertiary, marginTop: 2 },
    rowChevron: { fontSize: 20, color: C.textTertiary },
    divider: { height: 1, backgroundColor: C.border, marginHorizontal: Spacing.md },
    infoRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    },
    noBorder: { borderBottomWidth: 0 },
    infoLabel: { fontSize: FontSize.sm, color: C.textSecondary },
    infoValue: { fontSize: FontSize.sm, color: C.textTertiary },
  });
}
