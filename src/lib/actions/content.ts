"use server";

import { requireSection } from "@/lib/guard";

import { revalidatePublic } from "@/lib/public-cache";
import { createClient } from "@/lib/supabase/server";
import { homeContentSchema } from "@/lib/schemas";

export interface ContentResult {
  ok: boolean;
  error?: string;
}

/** Guarda o conteúdo da página inicial (site_content key='home'). */
export async function saveHomeContent(input: unknown): Promise<ContentResult> {
  await requireSection("pagina-inicial");
  const parsed = homeContentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("site_content")
    .upsert({ key: "home", content: parsed.data }, { onConflict: "key" });

  if (error) {
    console.error("saveHomeContent:", error.message);
    return { ok: false, error: error.message };
  }

  // A homepage é ISR — revalida para refletir de imediato.
  revalidatePublic("/");
  revalidatePublic("/admin/pagina-inicial");
  return { ok: true };
}
