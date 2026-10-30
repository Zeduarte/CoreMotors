"use server";

import { publicSubmissionClient } from "@/lib/public-submissions";
import { deliverNotificationsSoon } from "@/lib/notifications-kick";
import { requireSection } from "@/lib/guard";
import { revalidatePath } from "next/cache";
import { revalidatePublic } from "@/lib/public-cache";
import { createClient } from "@/lib/supabase/server";
import { publicTestimonialSchema } from "@/lib/schemas";

export interface TResult {
  ok: boolean;
  error?: string;
}

/**
 * Submissão PÚBLICA de testemunho por um visitante. Entra sempre por aprovar
 * (`published = false`) — só aparece no site depois de o staff o aprovar no
 * backoffice. A RLS (0008) só permite inserção anónima com published = false.
 */
export async function submitPublicTestimonial(input: unknown): Promise<TResult> {
  const parsed = publicTestimonialSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }
  const { name, rating, role, body } = parsed.data;

  let supabase;
  try { supabase = await publicSubmissionClient("testimonial", `${name}:${body}`); }
  catch (e) { return {ok:false,error:e instanceof Error ? e.message : "Tente novamente."}; }
  const { error } = await supabase.from("testimonials").insert({
    name,
    rating,
    body,
    role: role || null,
    published: false, // sempre pendente de aprovação
  });
  if (error) {
    console.error("submitPublicTestimonial:", error.message);
    return { ok: false, error: "Não foi possível enviar. Tente novamente." };
  }
  // Só a lista do backoffice muda: o testemunho entra por aprovar e não
  // aparece no site. `revalidatePublic` limpava a cache de dados e da CDN de
  // todo o site público a cada submissão anónima.
  revalidatePath("/admin/testemunhos");
  // Aviso a quem aprova testemunhos (agendado pela base de dados).
  deliverNotificationsSoon();
  return { ok: true };
}

function refresh() {
  revalidatePublic("/");
  revalidatePublic("/admin/testemunhos");
}

export async function createTestimonial(input: {
  name: string;
  rating: number;
  body: string;
  role?: string;
}): Promise<TResult> {
  const name = input.name?.trim();
  const body = input.body?.trim();
  const rating = Math.min(5, Math.max(1, Number(input.rating) || 5));
  if (!name || !body) return { ok: false, error: "Nome e texto obrigatórios." };

  await requireSection("testemunhos");
  const supabase = await createClient();
  const { error } = await supabase.from("testimonials").insert({
    name,
    body,
    rating,
    role: input.role?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

export async function setTestimonialPublished(
  id: string,
  published: boolean,
): Promise<TResult> {
  await requireSection("testemunhos");
  const supabase = await createClient();
  const { error } = await supabase
    .from("testimonials")
    .update({ published })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

export async function deleteTestimonial(id: string): Promise<TResult> {
  await requireSection("testemunhos");
  const supabase = await createClient();
  const { error } = await supabase.from("testimonials").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}
