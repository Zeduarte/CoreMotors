"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSection } from "@/lib/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { olxConfigured } from "@/lib/olx/client";
import { unwrap, type OlxCategory } from "@/lib/olx/categories";
import { olxFetch } from "@/lib/olx/client";
import { browseCategories, loadCategories, refreshStats, storeCategory, storeCategoryDetails, syncListing, syncPending } from "@/lib/olx/sync";
import { queueOlxSync } from "@/lib/olx/queue";
import { getCurrentProfile } from "@/lib/admin-queries";
import { canAccess } from "@/lib/permissions";
import { carTypesError } from "@/lib/vehicle-access";

/**
 * Ações do painel do OLX (Plataformas de anúncios) e da ficha da viatura.
 *
 * Correm com o cliente de serviço (os tokens do OLX não são legíveis por
 * nenhuma sessão), por isso cada uma começa por verificar o separador de quem
 * a chama — e, nas da ficha, o tipo da viatura: a RLS por tipo não se aplica
 * ao cliente de serviço.
 */

export interface OlxActionResult {
  ok: boolean;
  error?: string;
  message?: string;
  /** Categorias para o administrador escolher quando há dúvida. */
  candidates?: Partial<Record<"car" | "motorcycle", OlxCategory[]>>;
}

function admin() {
  const db = createAdminClient();
  if (!db) throw new Error("SUPABASE_SERVICE_ROLE_KEY em falta.");
  return db;
}

/**
 * As ações da ficha: separador «Viaturas», id válido e acesso ao tipo da
 * viatura, verificado com a sessão de quem pede (e a RLS dela). Devolve o erro
 * a mostrar, ou null.
 */
async function carActionError(carId: string): Promise<string | null> {
  const me = await requireSection("carros");
  if (!z.string().uuid().safeParse(carId).success) return "Viatura inválida.";
  return carTypesError(await createClient(), me, [carId]);
}

export async function disconnectOlx(): Promise<OlxActionResult> {
  await requireSection("anuncios");
  const { error } = await admin().from("olx_connection").delete().eq("id", 1);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/anuncios");
  return { ok: true, message: "Conta do OLX desligada. Os anúncios já publicados continuam no OLX." };
}

export async function loadOlxCategories(): Promise<OlxActionResult> {
  await requireSection("anuncios");
  if (!olxConfigured()) return { ok: false, error: "Faltam OLX_CLIENT_ID e OLX_CLIENT_SECRET no Netlify." };
  try {
    const r = await loadCategories(admin());
    revalidatePath("/admin/anuncios");
    if (!r.ok) return { ok: false, error: r.error };
    const escolhidas = Object.entries(r.chosen).map(([t, c]) => `${t === "car" ? "carros" : "motas"}: ${c!.name}`);
    const duvidas = Object.keys(r.ambiguous).length;
    const local = r.location
      ? ` Localização do stand no OLX: ${r.location}.`
      : r.locationError
        ? ` Atenção: ${r.locationError}.`
        : "";
    return {
      ok: true,
      message: (escolhidas.length
        ? `Categorias carregadas (${escolhidas.join(", ")}).${duvidas ? " Há categorias por escolher." : ""}`
        : duvidas
          ? "Escolha abaixo a categoria do OLX para carros e para motas."
          : `Não encontrei categorias de carros nem de motas. O OLX devolveu: ${(r.seen ?? []).join(", ") || "nada"}.`) + local,
      candidates: r.ambiguous,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao carregar categorias." };
  }
}

export async function chooseOlxCategory(data: FormData): Promise<OlxActionResult> {
  await requireSection("anuncios");
  const parsed = z
    .object({ vehicle_type: z.enum(["car", "motorcycle"]), category_id: z.coerce.number().int().positive() })
    .safeParse({ vehicle_type: data.get("vehicle_type"), category_id: data.get("category_id") });
  if (!parsed.success) return { ok: false, error: "Escolha uma categoria." };
  const db = admin();
  const c = await olxFetch<unknown>(db, `/categories/${parsed.data.category_id}`);
  if (!c.ok) return { ok: false, error: c.error ?? "Categoria inválida." };
  const erro = await storeCategory(db, parsed.data.vehicle_type, unwrap<OlxCategory>(c.data));
  revalidatePath("/admin/anuncios");
  return erro ? { ok: false, error: erro } : { ok: true, message: "Categoria guardada." };
}

export async function syncOlxNow(): Promise<OlxActionResult> {
  await requireSection("anuncios");
  const n = await syncPending(admin(), 50);
  revalidatePath("/admin/anuncios");
  return { ok: true, message: n ? `${n} anúncio(s) sincronizado(s).` : "Não havia nada por sincronizar." };
}

/** "Atualizar estatísticas": de todos os anúncios (Plataformas de anúncios) ou de uma
 * viatura (ficha). A manutenção diária faz o mesmo sozinha.
 */
export async function refreshOlxStats(carId?: string): Promise<OlxActionResult> {
  if (carId) {
    const denied = await carActionError(carId);
    if (denied) return { ok: false, error: denied };
  } else {
    await requireSection("anuncios");
  }
  const r = await refreshStats(admin(), carId ? [carId] : undefined);
  revalidatePath("/admin/anuncios");
  if (carId) revalidatePath(`/admin/carros/${carId}`);
  if (r.updated === 0 && r.error) return { ok: false, error: r.error };
  return {
    ok: true,
    message: r.failed
      ? `${r.updated} atualizado(s), ${r.failed} com erro (${r.error}).`
      : r.updated
        ? `Estatísticas de ${r.updated} anúncio(s) atualizadas.`
        : "Ainda não há anúncios no OLX.",
  };
}

/** "Tentar outra vez", na ficha da viatura. */
export async function retryOlxListing(carId: string): Promise<OlxActionResult> {
  const denied = await carActionError(carId);
  if (denied) return { ok: false, error: denied };
  const db = admin();
  await db.from("channel_listings").update({ sync_state: "pending", attempts: 0 }).eq("car_id", carId).eq("channel", "olx");
  const r = await syncListing(db, carId);
  revalidatePath(`/admin/carros/${carId}`);
  return r.ok ? { ok: true, message: "Sincronizado com o OLX." } : { ok: false, error: r.error };
}

// ---- Árvore de categorias -----------------------------------------------

export interface CategoryBrowse {
  ok: boolean;
  error?: string;
  categories?: OlxCategory[];
}

/** Um nível da árvore do OLX. Para quem gere Viaturas ou Plataformas de anúncios. */
export async function browseOlxCategories(parentId: number | null): Promise<CategoryBrowse> {
  const me = await getCurrentProfile();
  if (!me || !(canAccess(me.role, me.allowed_sections, "carros") || canAccess(me.role, me.allowed_sections, "anuncios")))
    return { ok: false, error: "Sem permissão." };
  if (parentId !== null && !(Number.isInteger(parentId) && parentId > 0)) return { ok: false, error: "Categoria inválida." };
  const r = await browseCategories(admin(), parentId);
  return r.ok ? { ok: true, categories: r.categories } : { ok: false, error: r.error };
}

const pickSchema = z.object({
  categoryId: z.number().int().positive(),
  path: z.string().trim().min(1).max(300),
});

/**
 * Confirma no OLX que a categoria existe e é final (só nas finais se pode
 * publicar). Devolve-a com os dados do OLX, não os que vieram do browser.
 */
async function leafCategory(categoryId: number): Promise<OlxCategory | string> {
  const c = await olxFetch<unknown>(admin(), `/categories/${categoryId}`);
  if (!c.ok) return c.error ?? "Categoria inválida.";
  const category = unwrap<OlxCategory>(c.data);
  if (!category?.id) return "Categoria inválida.";
  if (category.is_leaf === false) return "Escolha uma subcategoria: o OLX só aceita anúncios na última categoria.";
  return category;
}

/** Categoria padrão de um tipo de viatura (Plataformas de anúncios → OLX). */
export async function setDefaultOlxCategory(
  vehicleType: "car" | "motorcycle",
  categoryId: number,
  path: string,
): Promise<OlxActionResult> {
  await requireSection("anuncios");
  const parsed = pickSchema.safeParse({ categoryId, path });
  if (!parsed.success || !["car", "motorcycle"].includes(vehicleType)) return { ok: false, error: "Escolha uma categoria." };
  const category = await leafCategory(parsed.data.categoryId);
  if (typeof category === "string") return { ok: false, error: category };
  const erro = await storeCategory(admin(), vehicleType, category, parsed.data.path);
  revalidatePath("/admin/anuncios");
  return erro
    ? { ok: false, error: erro }
    : { ok: true, message: `Categoria dos ${vehicleType === "car" ? "carros" : "motas"} guardada. Carregue em «Sincronizar agora».` };
}

/**
 * Categoria só desta viatura (na ficha). `categoryId` nulo volta à padrão.
 * O anúncio é atualizado logo a seguir.
 */
export async function setCarOlxCategory(
  carId: string,
  categoryId: number | null,
  path?: string,
): Promise<OlxActionResult> {
  const denied = await carActionError(carId);
  if (denied) return { ok: false, error: denied };
  const db = admin();

  if (categoryId === null) {
    const { error } = await db.from("cars").update({ olx_category_id: null }).eq("id", carId);
    if (error) return { ok: false, error: missing0031(error.message) };
  } else {
    const parsed = pickSchema.safeParse({ categoryId, path });
    if (!parsed.success) return { ok: false, error: "Escolha uma categoria." };
    const category = await leafCategory(parsed.data.categoryId);
    if (typeof category === "string") return { ok: false, error: category };
    const details = await storeCategoryDetails(db, category, parsed.data.path);
    if (details.error) return { ok: false, error: details.error };
    const { error } = await db.from("cars").update({ olx_category_id: category.id }).eq("id", carId);
    if (error) return { ok: false, error: missing0031(error.message) };
  }

  await queueOlxSync([carId]);
  revalidatePath(`/admin/carros/${carId}`);
  return { ok: true, message: categoryId === null ? "A viatura volta à categoria padrão." : "Categoria do OLX guardada." };
}

function missing0031(message: string): string {
  return /olx_category_id|olx_category_details|does not exist|schema cache/i.test(message)
    ? "Falta aplicar a migração 0031 no Supabase."
    : message;
}
