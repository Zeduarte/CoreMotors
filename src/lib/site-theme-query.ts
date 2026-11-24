import "server-only";
import { cachedPublic, safely } from "@/lib/public-cache";
import { supabasePublic } from "@/lib/supabase/public";
import { DEFAULT_MODE, DEFAULT_THEME, THEME_IDS, parseSiteAppearance, type SiteAppearance, type ThemeId } from "@/themes/index";

/**
 * O tema do site público (Gestão → Versão do site): Core ou Core2, e a
 * aparência de cada um (Escuro, Claro ou Automático). Fica em `site_content`
 * (chave `theme`), que o público já lê. Sem nada guardado (ou sem acesso), o
 * Core, escuro.
 */
const fetchSiteAppearance = cachedPublic(async () => {
  const { data, error } = await supabasePublic
    .from("site_content")
    .select("content")
    .eq("key", "theme")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return parseSiteAppearance(data?.content ?? null);
}, "site-theme");

const FALLBACK: SiteAppearance = {
  theme: DEFAULT_THEME,
  mode: DEFAULT_MODE,
  modes: Object.fromEntries(THEME_IDS.map((id) => [id, DEFAULT_MODE])) as SiteAppearance["modes"],
  layouts: {},
};

export async function getSiteAppearance(): Promise<SiteAppearance> {
  return safely("getSiteTheme", fetchSiteAppearance, FALLBACK);
}

export async function getSiteTheme(): Promise<ThemeId> {
  return (await getSiteAppearance()).theme;
}
