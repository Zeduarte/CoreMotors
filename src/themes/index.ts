import { core } from "./core";
import { core2 } from "./core2";
import { THEME_IDS, type ThemeConfig, type ThemeId } from "./types";

export * from "./types";

export const THEMES: Record<ThemeId, ThemeConfig> = { core, core2 };
export const DEFAULT_THEME: ThemeId = "core";

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}

/** O tema guardado (`site_content`, chave `theme`: `{ theme: "core2" }`), ou o Core. */
export function parseThemeId(content: unknown): ThemeId {
  const raw = (content as { theme?: unknown } | null)?.theme;
  return isThemeId(raw) ? raw : DEFAULT_THEME;
}

export function getTheme(id: ThemeId): ThemeConfig {
  return THEMES[id] ?? THEMES[DEFAULT_THEME];
}
