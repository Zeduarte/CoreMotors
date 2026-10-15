import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Miniaturas das fotografias por confirmar, para a imagem da proposta.
 *
 * À parte de photos.ts porque a rota da imagem (preview.ts) só precisa disto,
 * e preview.ts é carregado sem o Next nos testes.
 */

/** O bucket privado das fotografias por confirmar (0039). Nunca público. */
export const STAGING_BUCKET = "wa-media";

export const THUMB_PX = 240;

/**
 * As miniaturas como `data:` URLs. A imagem da proposta é pedida pela Meta
 * sem sessão; o bucket é privado e não se dá a ninguém um link para ele — a
 * rota (que já validou o link assinado da proposta) lê os ficheiros com a
 * chave de serviço e desenha-os. Só as fotografias ainda por juntar, pela
 * ordem da proposta. Nunca lança.
 */
export async function photoThumbnails(
  db: SupabaseClient<Database>,
  ids: string[],
  max: number,
): Promise<string[]> {
  try {
    const wanted = ids.slice(0, max);
    if (!wanted.length) return [];
    const { data } = await db.from("wa_media").select("id,storage_path,status").in("id", wanted);
    const rows = new Map(
      ((data ?? []) as { id: string; storage_path: string; status: string }[]).map((r) => [r.id, r]),
    );
    const thumbs = await Promise.all(
      wanted.map(async (id) => {
        const row = rows.get(id);
        if (!row || row.status !== "staged") return null;
        const { data: blob } = await db.storage.from(STAGING_BUCKET).download(row.storage_path);
        if (!blob) return null;
        const small = await sharp(Buffer.from(await blob.arrayBuffer()), { failOn: "none" })
          .resize(THUMB_PX, THUMB_PX, { fit: "cover" })
          .jpeg({ quality: 70 })
          .toBuffer()
          .catch(() => null);
        return small ? `data:image/jpeg;base64,${small.toString("base64")}` : null;
      }),
    );
    return thumbs.filter((t): t is string => t !== null);
  } catch {
    return [];
  }
}
