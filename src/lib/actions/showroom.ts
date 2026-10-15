"use server";
import { afterShowroomSaved } from "@/lib/site-revalidate";
import { requireSection } from "@/lib/guard";
import { createClient } from "@/lib/supabase/server";
import {
  describeIssuePath,
  normalizeLocationIds,
  showroomSchema,
} from "@/lib/showroom";
export async function saveShowroom(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  await requireSection("pagina-inicial");
  // Corrige identificadores antes de validar: são gerados pelo sistema, não
  // é o utilizador que os escreve, por isso não o devem bloquear.
  const withIds =
    input && typeof input === "object" && Array.isArray((input as { locations?: unknown }).locations)
      ? {
          ...(input as object),
          locations: normalizeLocationIds(
            (input as { locations: { id: string; name: string }[] }).locations.map((l) => ({
              ...l,
              id: typeof l?.id === "string" ? l.id : "",
              name: typeof l?.name === "string" ? l.name : "",
            })),
          ),
        }
      : input;
  const parsed = showroomSchema.safeParse(withIds);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues
        .map((i) => `${describeIssuePath(i.path)}: ${i.message}`)
        .join("; "),
    };
  const db = await createClient();
  const { data: linked, error: readError } = await db
    .from("cars")
    .select("point_of_sale_id")
    .not("point_of_sale_id", "is", null);
  if (readError)
    return {
      ok: false,
      error:
        "Não foi possível verificar os pontos de venda. Confirme que a migração 0018 está aplicada.",
    };
  if (
    linked?.some(
      (c) =>
        c.point_of_sale_id &&
        !parsed.data.locations.some((p) => p.id === c.point_of_sale_id),
    )
  )
    return {
      ok: false,
      error:
        "Um ponto de venda está associado a viaturas. Reatribua essas viaturas antes de remover ou alterar o identificador.",
    };
  const { error } = await db
    .from("site_content")
    .upsert({ key: "showroom", content: parsed.data }, { onConflict: "key" });
  if (error)
    return { ok: false, error: "Não foi possível guardar os conteúdos." };
  // O ponto de venda principal é a fonte dos contactos de todo o site
  // (rodapé, contactos, WhatsApp, OLX): a cache da marca tem de cair.
  afterShowroomSaved();
  return { ok: true };
}
