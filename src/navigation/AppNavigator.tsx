import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import DashboardScreen from '../screens/Dashboard/DashboardScreen';
import PortfoliosScreen from '../screens/Portfolios/PortfoliosScreen';
import HoldingsScreen from '../screens/Holdings/HoldingsScreen';
import PerformanceScreen from '../screens/Performance/PerformanceScreen';
import { Colors, Spacing, FontSize, FontWeight, Radius } from '../theme';

export type TabParamList = {
  Dashboard: undefined;
  Portfolios: undefined;
  Holdings: undefined;
  Performance: undefined;
};

type TabKey = keyof TabParamList;

const TAB_ITEMS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'Dashboard', label: '仪表盘', icon: '📊' },
  { key: 'Portfolios', label: '我的组合', icon: '📁' },
  { key: 'Holdings', label: '持仓明细', icon: '📋' },
  { key: 'Performance', label: '绩效分析', icon: '📈' },
];

const SCREENS: Record<TabKey, React.ComponentType<any>> = {
  Dashboard: DashboardScreen,
  Portfolios: PortfoliosScreen,
  Holdings: HoldingsScreen,
  Performance: PerformanceScreen,
};

const Tab = createBottomTabNavigator<TabParamList>();

// ─── iPhone：底部 Tab ───────────────────────────────────────
function PhoneTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textTertiary,
        tabBarLabelStyle: { fontSize: FontSize.xs },
        tabBarLabel: TAB_ITEMS.find(t => t.key === route.name)?.label ?? route.name,
      })}>
      {TAB_ITEMS.map(item => (
        <Tab.Screen key={item.key} name={item.key} component={SCREENS[item.key]} />
      ))}
    </Tab.Navigator>
  );
}

// ─── iPad：永久侧边栏（纯 View，无需 reanimated）────────────
function PadSidebarLayout() {
  const [activeTab, setActiveTab] = useState<TabKey>('Dashboard');
  const ActiveScreen = SCREENS[activeTab];

  return (
    <View style={padStyles.container}>
      <View style={padStyles.sidebar}>
        <Text style={padStyles.appTitle}>Portfolio</Text>
        {TAB_ITEMS.map(item => {
          const isActive = item.key === activeTab;
          return (
            <TouchableOpacity
              key={item.key}
              style={[padStyles.sidebarItem, isActive && padStyles.sidebarItemActive]}
              onPress={() => setActiveTab(item.key)}>
              <Text style={padStyles.sidebarIcon}>{item.icon}</Text>
              <Text style={[padStyles.sidebarLabel, isActive && padStyles.sidebarLabelActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={padStyles.content}>
        <ActiveScreen />
      </View>
    </View>
  );
}

const padStyles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', backgroundColor: Colors.background },
  sidebar: {
    width: 220,
    backgroundColor: Colors.surface,
    borderRightWidth: 1,
    borderRightColor: Colors.border,
    paddingTop: Spacing.xxl,
    paddingHorizontal: Spacing.md,
  },
  appTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
    marginBottom: Spacing.xl,
    paddingHorizontal: Spacing.sm,
  },
  sidebarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
    marginBottom: Spacing.xs,
  },
  sidebarItemActive: { backgroundColor: Colors.surfaceElevated },
  sidebarIcon: { fontSize: 18, marginRight: Spacing.sm },
  sidebarLabel: { fontSize: FontSize.md, color: Colors.textSecondary, fontWeight: FontWeight.medium },
  sidebarLabelActive: { color: Colors.primary, fontWeight: FontWeight.semibold },
  content: { flex: 1 },
});

// ─── 根导航：按设备宽度选择 ─────────────────────────────────
export default function AppNavigator() {
  const { width } = useWindowDimensions();
  const isTablet = Platform.OS === 'ios' && width >= 768;

  if (isTablet) {
    return <PadSidebarLayout />;
  }

  return (
    <NavigationContainer>
      <PhoneTabNavigator />
    </NavigationContainer>
  );
}
