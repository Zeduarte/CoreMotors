"use client";

import { createContext, useContext } from "react";
import { DEFAULT_THEME, getTheme, type ThemeConfig, type ThemeId, type ThemeTexts } from "@/themes/index";

/** O tema do site público (Core / Core2), para os componentes do browser. */
const Theme = createContext<ThemeConfig>(getTheme(DEFAULT_THEME));

export function SiteThemeProvider({ theme, children }: { theme: ThemeId; children: React.ReactNode }) {
  return <Theme.Provider value={getTheme(theme)}>{children}</Theme.Provider>;
}

export function useSiteTheme(): ThemeConfig {
  return useContext(Theme);
}

/** Um texto do tema (ex.: o nome de um item do menu). */
export function useThemeText(key: keyof ThemeTexts): string {
  return useContext(Theme).texts[key];
}
