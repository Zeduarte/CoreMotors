"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/admin-queries";
import { revalidatePublic } from "@/lib/public-cache";
import { createClient } from "@/lib/supabase/server";
import { isThemeId } from "@/themes/index";

export interface GestaoResult {
  ok: boolean;
  error?: string;
}

/**
 * Gestão → Versão do site: o tema do site público (Core / Core2). Só o acesso
 * core (o dono da conta); na base de dados, a 0055 faz a mesma regra.
 */
export async function saveSiteTheme(theme: unknown): Promise<GestaoResult> {
  const me = await getCurrentProfile();
  if (!me?.is_owner) return { ok: false, error: "Só o acesso core pode mudar a versão do site." };
  if (!isThemeId(theme)) return { ok: false, error: "Escolha uma das versões." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("site_content")
    .upsert({ key: "theme", content: { theme } }, { onConflict: "key" });
  if (error) return { ok: false, error: error.message };
  // Muda o site inteiro (o tema está no layout público).
  revalidatePublic("/", "layout");
  revalidatePath("/admin/gestao");
  return { ok: true };
}
