"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/admin-queries";
import { revalidatePublic } from "@/lib/public-cache";
import { createClient } from "@/lib/supabase/server";
import { THEME_IDS, getTheme, isMobileMenu, isSiteMode, isThemeId, resolveLayout, type SiteMode, type ThemeId } from "@/themes/index";

export interface GestaoResult {
  ok: boolean;
  error?: string;
}

/**
 * Gestão → Versão do site: o tema do site público (Core / Core2 / Core3) e a aparência
 * de cada um (Escuro, Claro ou Automático). Só o acesso core (o dono da conta);
 * na base de dados, a 0055 faz a mesma regra.
 */
export async function saveSiteTheme(theme: unknown, modes?: unknown, mobileMenu?: unknown): Promise<GestaoResult> {
  const me = await getCurrentProfile();
  if (!me?.is_owner) return { ok: false, error: "Só o acesso core pode mudar a versão do site." };
  if (!isThemeId(theme)) return { ok: false, error: "Escolha uma das versões." };
  // A aparência de cada versão (todas as versões, cada uma com um modo conhecido).
  let content: { theme: ThemeId; modes?: Record<ThemeId, SiteMode>; mobileMenu?: string } = { theme };
  if (mobileMenu !== undefined) {
    if (!isMobileMenu(mobileMenu)) return { ok: false, error: "Escolha o menu em cima ou em baixo." };
    content.mobileMenu = mobileMenu;
  }
  if (modes !== undefined) {
    const m = modes as Record<string, unknown> | null;
    if (!m || typeof m !== "object" || !THEME_IDS.every((id) => isSiteMode(m[id])))
      return { ok: false, error: "Escolha Escuro, Claro ou Automático para cada versão." };
    content = { ...content, modes: Object.fromEntries(THEME_IDS.map((id) => [id, m[id]])) as Record<ThemeId, SiteMode> };
  }
  return writeThemeContent(content);
}

/**
 * Gestão → Página inicial: as secções de um tema e a ordem. Só o acesso core.
 * A lista chega do formulário e é limpa aqui (só secções desse tema, sem as
 * fixas nem repetidas), por isso nunca se guarda uma página partida.
 */
export async function saveHomeLayout(theme: unknown, items: unknown): Promise<GestaoResult> {
  const me = await getCurrentProfile();
  if (!me?.is_owner) return { ok: false, error: "Só o acesso core pode mudar a página inicial." };
  if (!isThemeId(theme)) return { ok: false, error: "Escolha uma das versões." };
  if (!Array.isArray(items)) return { ok: false, error: "Lista de secções inválida." };
  return writeThemeContent({ layouts: { [theme]: resolveLayout(getTheme(theme), items) } });
}

/**
 * Junta o que muda ao que já está guardado (versão, aparências e as listas de
 * cada tema ficam no mesmo registo: guardar uma não apaga as outras).
 */
async function writeThemeContent(patch: Record<string, unknown>): Promise<GestaoResult> {
  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from("site_content")
    .select("content")
    .eq("key", "theme")
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  const prev = (current?.content ?? {}) as Record<string, unknown>;
  const layouts = { ...((prev.layouts as object) ?? {}), ...((patch.layouts as object) ?? {}) };
  const content = { ...prev, ...patch, ...(Object.keys(layouts).length ? { layouts } : {}) };
  const { error } = await supabase.from("site_content").upsert({ key: "theme", content }, { onConflict: "key" });
  if (error) return { ok: false, error: error.message };
  // Muda o site inteiro (o tema está no layout público).
  revalidatePublic("/", "layout");
  revalidatePath("/admin/gestao");
  return { ok: true };
}
