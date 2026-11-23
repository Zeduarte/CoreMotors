"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/admin-queries";
import { revalidatePublic } from "@/lib/public-cache";
import { createClient } from "@/lib/supabase/server";
import { THEME_IDS, isSiteMode, isThemeId, type SiteMode, type ThemeId } from "@/themes/index";

export interface GestaoResult {
  ok: boolean;
  error?: string;
}

/**
 * Gestão → Versão do site: o tema do site público (Core / Core2) e a aparência
 * de cada um (Escuro, Claro ou Automático). Só o acesso core (o dono da conta);
 * na base de dados, a 0055 faz a mesma regra.
 */
export async function saveSiteTheme(theme: unknown, modes?: unknown): Promise<GestaoResult> {
  const me = await getCurrentProfile();
  if (!me?.is_owner) return { ok: false, error: "Só o acesso core pode mudar a versão do site." };
  if (!isThemeId(theme)) return { ok: false, error: "Escolha uma das versões." };
  // A aparência de cada versão (todas as versões, cada uma com um modo conhecido).
  let content: { theme: ThemeId; modes?: Record<ThemeId, SiteMode> } = { theme };
  if (modes !== undefined) {
    const m = modes as Record<string, unknown> | null;
    if (!m || typeof m !== "object" || !THEME_IDS.every((id) => isSiteMode(m[id])))
      return { ok: false, error: "Escolha Escuro, Claro ou Automático para cada versão." };
    content = { theme, modes: Object.fromEntries(THEME_IDS.map((id) => [id, m[id]])) as Record<ThemeId, SiteMode> };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("site_content")
    .upsert({ key: "theme", content }, { onConflict: "key" });
  if (error) return { ok: false, error: error.message };
  // Muda o site inteiro (o tema está no layout público).
  revalidatePublic("/", "layout");
  revalidatePath("/admin/gestao");
  return { ok: true };
}
