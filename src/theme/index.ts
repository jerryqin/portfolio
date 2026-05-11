export const DarkColors = {
  // 背景层级
  background: '#0D0D0F',
  surface: '#1A1A1F',
  surfaceElevated: '#242429',
  border: '#2C2C35',

  // 主色
  primary: '#4F8EF7',
  primaryDark: '#3A6FD8',

  // 盈亏颜色（美股惯例：绿涨红跌）
  profit: '#00C48C',
  loss: '#FF5C5C',
  neutral: '#8A8A99',

  // 文字层级
  textPrimary: '#FFFFFF',
  textSecondary: '#AEAEBE',
  textTertiary: '#6B6B7B',

  // 三层仓位色
  coreColor: '#4F8EF7',
  satelliteColor: '#A78BFA',
  tradingColor: '#F59E0B',

  // 现金
  cashColor: '#6B7280',
};

export const LightColors = {
  // 背景层级
  background: '#F2F2F7',
  surface: '#FFFFFF',
  surfaceElevated: '#F2F2F7',
  border: '#E5E5EA',

  // 主色
  primary: '#007AFF',
  primaryDark: '#0063CC',

  // 盈亏颜色
  profit: '#34C759',
  loss: '#FF3B30',
  neutral: '#8E8E93',

  // 文字层级
  textPrimary: '#000000',
  textSecondary: '#3C3C43',
  textTertiary: '#8E8E93',

  // 三层仓位色
  coreColor: '#007AFF',
  satelliteColor: '#AF52DE',
  tradingColor: '#FF9500',

  // 现金
  cashColor: '#8E8E93',
};

// 默认导出深色主题（向后兼容旧 import，会被 useColors 动态替换）
export const Colors = DarkColors;

export type ThemeColors = typeof DarkColors;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

export const FontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  display: 32,
};

export const FontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};
