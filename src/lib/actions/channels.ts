"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireSection } from "@/lib/guard";
import { CHANNEL_IDS } from "@/lib/schemas";
import type { ChannelListingInsert } from "@/lib/supabase/database.types";
import { carTypesError } from "@/lib/vehicle-access";

export interface ListingResult {
  ok: boolean;
  error?: string;
}

const listingSchema = z.object({
  car_id: z.string().uuid(),
  channel: z.enum(CHANNEL_IDS as [string, ...string[]]),
  status: z.enum(["pending", "published", "removed", "error"]).default("pending"),
  external_url: z
    .string()
    .trim()
    .url("URL inválido")
    .max(500)
    .optional()
    .or(z.literal("")),
  external_id: z.string().trim().max(120).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export type ListingInput = z.input<typeof listingSchema>;

/**
 * Cria/atualiza o estado de publicação de uma viatura num canal.
 * `published_at` é preenchido automaticamente quando passa a "published" e
 * ainda não tinha data.
 */
export async function saveListing(input: ListingInput): Promise<ListingResult> {
  const profile = await requireSection("carros");

  const parsed = listingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const v = parsed.data;

  const supabase = await createClient();
  // A RLS dos anúncios só pede sessão da equipa: o tipo da viatura vê-se aqui.
  const denied = await carTypesError(supabase, profile, [v.car_id]);
  if (denied) return { ok: false, error: denied };

  // Já existe registo para (car_id, channel)?
  const { data: existing } = await supabase
    .from("channel_listings")
    .select("id, published_at")
    .eq("car_id", v.car_id)
    .eq("channel", v.channel)
    .maybeSingle();

  const published_at =
    v.status === "published"
      ? existing?.published_at ?? new Date().toISOString()
      : v.status === "removed"
        ? existing?.published_at ?? null
        : null;

  const row: ChannelListingInsert = {
    car_id: v.car_id,
    channel: v.channel,
    status: v.status,
    external_url: v.external_url || null,
    external_id: v.external_id || null,
    notes: v.notes || null,
    published_at,
    created_by: profile.id,
  };

  const { error } = existing
    ? await supabase
        .from("channel_listings")
        .update(row)
        .eq("id", existing.id)
    : await supabase.from("channel_listings").insert(row);

  if (error) {
    const hint = /relation .*channel_listings.* does not exist/i.test(error.message)
      ? "A tabela channel_listings não existe. Aplique a migração 0014_channel_listings.sql no Supabase."
      : error.message;
    return { ok: false, error: hint };
  }

  revalidatePath(`/admin/carros/${v.car_id}`);
  revalidatePath("/admin/integracoes");
  return { ok: true };
}

/** Remove o registo de publicação de um canal (não afeta o feed). */
export async function deleteListing(id: string): Promise<ListingResult> {
  const profile = await requireSection("carros");
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Registo inválido." };
  const supabase = await createClient();
  const { data: listing } = await supabase.from("channel_listings").select("car_id").eq("id", id).maybeSingle();
  if (!listing) return { ok: false, error: "Registo não encontrado." };
  const denied = await carTypesError(supabase, profile, [listing.car_id]);
  if (denied) return { ok: false, error: denied };
  const { error } = await supabase
    .from("channel_listings")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
