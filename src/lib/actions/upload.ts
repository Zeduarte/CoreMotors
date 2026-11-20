"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAdmin, requireCarsAccess, requireSection } from "@/lib/guard";
import { mediaStorage } from "@/lib/storage";
import { presignPut } from "@/lib/r2";

/**
 * Para onde o browser carrega as fotos: com o Cloudflare R2 ligado, devolve
 * um endereço assinado por ficheiro (vale 10 minutos, só para aquele caminho);
 * com o Supabase, o browser carrega como sempre (com a sessão).
 *
 * O caminho é escolhido aqui (`<viatura>/<uuid>.<ext>` ou `branding/…`) — o
 * browser não escolhe onde grava.
 */

export interface UploadTarget {
  path: string;
  url: string;
  headers: Record<string, string>;
}
export type UploadTargets =
  | { ok: true; mode: "supabase" }
  | { ok: true; mode: "r2"; targets: UploadTarget[] }
  | { ok: false; error: string };

const fileSchema = z.object({
  ext: z.string().regex(/^[a-z0-9]{2,5}$/),
  contentType: z.string().regex(/^(image\/[a-z0-9.+-]+|video\/(mp4|webm))$/),
});
const inputSchema = z.union([
  z.object({ scope: z.literal("car"), carId: z.string().uuid(), files: z.array(fileSchema).min(1).max(50) }),
  z.object({ scope: z.literal("branding"), files: z.array(fileSchema).length(1) }),
]);

export async function getUploadTargets(input: unknown): Promise<UploadTargets> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Ficheiros inválidos." };
  const req = parsed.data;
  if (req.scope === "car") {
    await requireSection("carros");
    await requireCarsAccess([req.carId]);
  } else if (!(await requireAdmin())) {
    return { ok: false, error: "Sem permissão. Apenas administradores." };
  }
  if (mediaStorage() !== "r2") return { ok: true, mode: "supabase" };

  try {
    const folder = req.scope === "car" ? req.carId : "branding";
    const targets = await Promise.all(
      req.files.map(async (f) => {
        const path = `${folder}/${randomUUID()}.${f.ext}`;
        return { path, ...(await presignPut(path, f.contentType)) };
      }),
    );
    return { ok: true, mode: "r2", targets };
  } catch (e) {
    console.error("getUploadTargets:", e);
    return { ok: false, error: "O armazenamento das fotos (Cloudflare R2) não está bem configurado." };
  }
}
