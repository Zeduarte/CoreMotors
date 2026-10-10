"use server";

import { revalidateTag } from "next/cache";
import { revalidatePublic } from "@/lib/public-cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/admin-queries";
import { mergeBadges } from "@/lib/badges";
import {
  siteSettingsSchema,
  marketingSchema,
  integrationsSchema,
  companySchema,
  workshopSchema,
} from "@/lib/schemas";

export interface SettingsResult {
  ok: boolean;
  error?: string;
}

async function requireAdmin(): Promise<boolean> {
  const profile = await getCurrentProfile();
  return profile?.role === "admin";
}

const badgeSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/),
        label: z.string().trim().min(1, "Cada etiqueta precisa de um texto").max(30, "Texto da etiqueta demasiado longo"),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida"),
        enabled: z.boolean(),
      }),
    )
    .max(40),
});

/**
 * Etiquetas dos cards: texto, cor e se aparecem; e as do stand. As
 * automáticas não se apagam (o `mergeBadges` repõe-nas). Apenas admin.
 */
export async function saveBadges(input: unknown): Promise<SettingsResult> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "Sem permissão. Apenas administradores." };
  }
  const parsed = badgeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const items = mergeBadges(parsed.data).map(({ id, label, color, enabled }) => ({ id, label, color, enabled }));
  const supabase = await createClient();
  const { error } = await supabase
    .from("site_content")
    .upsert({ key: "badges", content: { items } }, { onConflict: "key" });
  if (error) return { ok: false, error: error.message };
  // Os cards aparecem em todo o site público.
  revalidatePublic("/", "layout");
  revalidatePublic("/admin/definicoes");
  return { ok: true };
}

/** Guarda o valor/hora da mão de obra da oficina. Apenas admin. */
export async function saveWorkshopRate(input: unknown): Promise<SettingsResult> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "Sem permissão. Apenas administradores." };
  }
  const parsed = workshopSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("site_settings").upsert(
    { id: 1, workshop_hourly_rate: parsed.data.workshop_hourly_rate },
    { onConflict: "id" },
  );
  if (error) {
    const hint = /workshop_hourly_rate/.test(error.message)
      ? "Aplique a migração 0016_workshop_rate.sql no Supabase."
      : error.message;
    return { ok: false, error: hint };
  }
  revalidatePublic("/admin/definicoes");
  revalidatePublic("/admin/financeiro");
  return { ok: true };
}

/** Guarda a marca do site (nome + logótipo). Apenas admin. */
export async function saveSiteSettings(input: unknown): Promise<SettingsResult> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "Sem permissão. Apenas administradores." };
  }

  const parsed = siteSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("site_settings").upsert(
    {
      id: 1,
      company_name: parsed.data.company_name,
      tagline: parsed.data.tagline || null,
      logo_url: parsed.data.logo_url ?? null,
      accent: parsed.data.accent,
      accent_soft: parsed.data.accent_soft,
    },
    { onConflict: "id" },
  );

  if (error) {
    console.error("saveSiteSettings:", error.message);
    return { ok: false, error: error.message };
  }

  // A marca aparece em todo o site → invalida a cache e revalida as páginas.
  revalidateTag("branding");
  revalidatePublic("/", "layout");
  revalidatePublic("/admin", "layout");
  return { ok: true };
}

/** Guarda os dados de contacto/empresa (telefone, email, morada…). Apenas admin. */
export async function saveCompany(input: unknown): Promise<SettingsResult> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "Sem permissão. Apenas administradores." };
  }

  const parsed = companySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }

  const d = parsed.data;
  const supabase = await createClient();
  // Só os canais de conversa: telefone, email, morada, horário e mapa vêm
  // agora do ponto de venda principal (Página inicial). O que estava aqui
  // fica intacto, como reserva enquanto não houver pontos de venda.
  const { error } = await supabase.from("site_settings").upsert(
    {
      id: 1,
      whatsapp: d.whatsapp || null,
      messenger: d.messenger || null,
    },
    { onConflict: "id" },
  );

  if (error) {
    console.error("saveCompany:", error.message);
    return { ok: false, error: error.message };
  }

  // Os contactos aparecem em todo o site → invalida a cache e revalida.
  revalidateTag("branding");
  revalidatePublic("/", "layout");
  return { ok: true };
}

/** Guarda definições de marketing/reservas (GA4, Pixel, sinal). Apenas admin. */
export async function saveMarketing(input: unknown): Promise<SettingsResult> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "Sem permissão. Apenas administradores." };
  }

  const parsed = marketingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("site_settings").upsert(
    {
      id: 1,
      ga4_id: parsed.data.ga4_id || null,
      pixel_id: parsed.data.pixel_id || null,
      reservation_enabled: parsed.data.reservation_enabled,
      deposit_amount: parsed.data.deposit_amount,
    },
    { onConflict: "id" },
  );

  if (error) {
    console.error("saveMarketing:", error.message);
    return { ok: false, error: error.message };
  }

  revalidateTag("branding");
  revalidatePublic("/", "layout");
  return { ok: true };
}

/** Guarda credenciais das plataformas de exportação e do pagamento. Apenas admin. */
export async function saveIntegrations(input: unknown): Promise<SettingsResult> {
  if (!(await requireAdmin())) {
    return { ok: false, error: "Sem permissão. Apenas administradores." };
  }

  const parsed = integrationsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("integration_secrets").upsert(
    { id: 1, data: parsed.data as Record<string, unknown> },
    { onConflict: "id" },
  );

  if (error) {
    console.error("saveIntegrations:", error.message);
    return { ok: false, error: error.message };
  }

  revalidatePublic("/admin/integracoes");
  return { ok: true };
}
