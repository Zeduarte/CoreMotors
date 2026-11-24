import { core } from "./core";
import { core2 } from "./core2";
import { core3 } from "./core3";
import { SITE_MODES, THEME_IDS, type SiteMode, type ThemeConfig, type ThemeId } from "./types";

export * from "./types";

export const THEMES: Record<ThemeId, ThemeConfig> = { core, core2, core3 };
export const DEFAULT_THEME: ThemeId = "core";

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}

/** O tema guardado (`site_content`, chave `theme`: `{ theme: "core2" }`), ou o Core. */
export function parseThemeId(content: unknown): ThemeId {
  const raw = (content as { theme?: unknown } | null)?.theme;
  return isThemeId(raw) ? raw : DEFAULT_THEME;
}

export const DEFAULT_MODE: SiteMode = "dark";

export function isSiteMode(value: unknown): value is SiteMode {
  return typeof value === "string" && (SITE_MODES as readonly string[]).includes(value);
}

/**
 * A aparência guardada para cada versão (`site_content`, chave `theme`:
 * `{ theme: "core2", modes: { core: "dark", core2: "light" } }`). O que faltar
 * (ou não for válido) é Escuro, o de sempre.
 */
export function parseSiteModes(content: unknown): Record<ThemeId, SiteMode> {
  const raw = (content as { modes?: Record<string, unknown> } | null)?.modes;
  return Object.fromEntries(
    THEME_IDS.map((id) => [id, raw && isSiteMode(raw[id]) ? raw[id] : DEFAULT_MODE]),
  ) as Record<ThemeId, SiteMode>;
}

/** A versão em uso e a aparência dela. */
export interface SiteAppearance {
  theme: ThemeId;
  mode: SiteMode;
  modes: Record<ThemeId, SiteMode>;
}

export function parseSiteAppearance(content: unknown): SiteAppearance {
  const theme = parseThemeId(content);
  const modes = parseSiteModes(content);
  return { theme, mode: modes[theme], modes };
}

export function getTheme(id: ThemeId): ThemeConfig {
  return THEMES[id] ?? THEMES[DEFAULT_THEME];
}
