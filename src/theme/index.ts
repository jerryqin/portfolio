export const Colors = {
  // 背景层级
  background: '#0D0D0F',
  surface: '#1A1A1F',
  surfaceElevated: '#242429',
  border: '#2C2C35',

  // 主色
  primary: '#4F8EF7',
  primaryDark: '#3A6FD8',

  // 盈亏颜色（A股反色：红涨绿跌，美股绿涨红跌，此处采用美股惯例）
  profit: '#00C48C',
  loss: '#FF5C5C',
  neutral: '#8A8A99',

  // 文字层级
  textPrimary: '#FFFFFF',
  textSecondary: '#AEAEBE',
  textTertiary: '#6B6B7B',

  // 三层仓位色
  coreColor: '#4F8EF7',    // 核心仓 - 蓝
  satelliteColor: '#A78BFA', // 卫星仓 - 紫
  tradingColor: '#F59E0B',  // 交易仓 - 金

  // 现金
  cashColor: '#6B7280',
};

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
