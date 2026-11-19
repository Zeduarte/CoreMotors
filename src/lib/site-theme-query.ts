import "server-only";
import { cachedPublic, safely } from "@/lib/public-cache";
import { supabasePublic } from "@/lib/supabase/public";
import { DEFAULT_THEME, parseThemeId, type ThemeId } from "@/themes/index";

/**
 * O tema do site público (Gestão → Versão do site): Core ou Core2. Fica em
 * `site_content` (chave `theme`), que o público já lê. Sem nada guardado (ou
 * sem acesso), o Core.
 */
const fetchSiteTheme = cachedPublic(async () => {
  const { data, error } = await supabasePublic
    .from("site_content")
    .select("content")
    .eq("key", "theme")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return parseThemeId(data?.content ?? null);
}, "site-theme");

export async function getSiteTheme(): Promise<ThemeId> {
  return safely("getSiteTheme", fetchSiteTheme, DEFAULT_THEME);
}
