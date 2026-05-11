import { DarkColors, LightColors, ThemeColors } from './index';
import { useThemeStore } from '../store/themeStore';

/**
 * Returns the current color palette (dark or light) based on theme store.
 * Usage: `const Colors = useColors();`
 */
export function useColors(): ThemeColors {
  const isDark = useThemeStore(s => s.isDark);
  return isDark ? DarkColors : LightColors;
}
