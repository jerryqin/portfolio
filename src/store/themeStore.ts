import { create } from 'zustand';

interface ThemeState {
  isDark: boolean;
  toggleTheme: () => void;
  setDark: (dark: boolean) => void;
}

export const useThemeStore = create<ThemeState>(set => ({
  isDark: false,
  toggleTheme: () => set(s => ({ isDark: !s.isDark })),
  setDark: (dark: boolean) => set({ isDark: dark }),
}));
