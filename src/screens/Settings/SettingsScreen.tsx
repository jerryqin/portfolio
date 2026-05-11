import React from 'react';
import {
  View,
  Text,
  Switch,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing, FontSize, FontWeight, Radius, ThemeColors } from '../../theme';
import { useColors } from '../../theme/useColors';
import { useThemeStore } from '../../store/themeStore';

export default function SettingsScreen() {
  const Colors = useColors();
  const { isDark, toggleTheme } = useThemeStore();
  const styles = makeStyles(Colors);

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

        {/* 关于 */}
        <Text style={styles.groupHeader}>关于</Text>
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>版本</Text>
            <Text style={styles.infoValue}>0.1.1</Text>
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
