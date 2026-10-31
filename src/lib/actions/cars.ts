"use server";

import { requireSection } from "@/lib/guard";

import { revalidatePath, revalidateTag } from "next/cache";
import { PUBLIC_DATA_TAG } from "@/lib/public-cache";
import { createClient } from "@/lib/supabase/server";
import { carFormSchema } from "@/lib/schemas";
import { vehicleSlug } from "@/lib/slug";
import { MEDIA_BUCKET } from "@/lib/storage";
import type { CarInsert, CarStatus } from "@/lib/supabase/database.types";
import { olxAdvertIds, queueOlxSync, retireOlxAdverts } from "@/lib/olx/queue";
import { deliverNotificationsSoon } from "@/lib/notifications-kick";
import { createAdminClient } from "@/lib/supabase/admin";
import { manualStatusError } from "@/lib/car-status";
import { canUseVehicleType, carTypesError, VEHICLE_TYPE_DENIED } from "@/lib/vehicle-access";
import type { ProfileRow } from "@/lib/supabase/database.types";

export interface SaveResult {
  ok: boolean;
  id?: string;
  slug?: string;
  error?: string;
  /** Texto do aviso quando corre bem (ex.: o resumo de uma ação em lote). */
  message?: string;
  fieldErrors?: Record<string, string>;
}

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * O que se sabe da venda e da reserva de cada viatura, para as regras de
 * `manualStatusError`. Lido com o cliente de serviço quando existe: quem muda o
 * estado em Viaturas pode não ter acesso a Contactos nem a Custos e margens, e
 * a regra não pode depender disso.
 */
async function salesState(db: Db, ids: string[]) {
  const read = createAdminClient() ?? db;
  const [won, financials, reservations] = await Promise.all([
    read.from("leads").select("car_id").in("car_id", ids).eq("status", "won"),
    read.from("vehicle_financials").select("car_id").in("car_id", ids).not("sale_lead_id", "is", null),
    read.from("reservations").select("car_id,status").in("car_id", ids),
  ]);
  const sale = new Set([...(won.data ?? []), ...(financials.data ?? [])].map((r) => r.car_id));
  const active = new Set((reservations.data ?? []).filter((r) => r.status === "active").map((r) => r.car_id));
  const anyReservation = new Set((reservations.data ?? []).map((r) => r.car_id));
  return {
    saleRecorded: (id: string) => sale.has(id),
    activeReservation: (id: string) => active.has(id),
    /** Reservas (de qualquer estado) ou venda: o histórico tem de ficar. */
    hasHistory: (id: string) => sale.has(id) || anyReservation.has(id),
  };
}

const carLabel = (c: { make: string; model: string }) => `${c.make} ${c.model}`.trim();

/** Revalida as páginas públicas afetadas por uma alteração de inventário. */
function revalidatePublic(slug?: string) {
  // As leituras públicas estão em cache: limpa-as para o site mostrar já.
  revalidateTag(PUBLIC_DATA_TAG);
  revalidatePath("/");
  revalidatePath("/inventario");
  revalidatePath("/sitemap.xml");
  revalidatePath("/vendidos");
  revalidatePath("/viaturas/[slug]", "page");
  revalidatePath("/api/feeds/[platform]", "page");
  if (slug) revalidatePath(`/viaturas/${slug}`);
  revalidatePath("/admin/carros");
  revalidatePath("/admin");
}

/** Garante um slug único (base, base-2, base-3, …), ignorando `exceptId`. */
async function uniqueSlug(
  supabase: Awaited<ReturnType<typeof createClient>>,
  base: string,
  exceptId?: string,
): Promise<string> {
  let candidate = base || "viatura";
  let n = 1;
  for (;;) {
    const query = supabase.from("cars").select("id").eq("slug", candidate);
    const { data } = exceptId
      ? await query.neq("id", exceptId).maybeSingle()
      : await query.maybeSingle();
    if (!data) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

function toRow(
  values: ReturnType<typeof carFormSchema.parse>,
): Omit<CarInsert, "slug"> {
  return {
    make: values.make,
    model: values.model,
    variant: values.variant || null,
    year: values.year,
    registration_month: values.registration_month ?? null,
    vehicle_type: values.vehicle_type,
    point_of_sale_id: values.point_of_sale_id || null,
    license_plate: values.license_plate || null,
    mileage: values.mileage,
    fuel: values.fuel,
    transmission: values.transmission,
    body: values.body,
    power: values.power,
    displacement: values.displacement,
    color: values.color || null,
    doors: values.doors,
    seats: values.seats,
    price: values.price_on_request ? null : (values.price ?? null),
    price_on_request: values.price_on_request,
    status: values.status,
    featured: values.featured,
    tagline: values.tagline || null,
    description: values.description || null,
    extras: values.extras,
    location: values.location || null,
    previous_price: values.previous_price ?? null,
    national: values.national,
    owners: values.owners ?? null,
    first_owner: values.first_owner,
    service_book: values.service_book,
    warranty_months: values.warranty_months ?? null,
    last_inspection: values.last_inspection || null,
    channels: values.channels ?? [],
    olx_attributes: values.olx_attributes ?? {},
    badges: values.badges ?? [],
  };
}

export async function createCar(input: unknown): Promise<SaveResult> {
  const me = await requireSection("carros");
  const parsed = carFormSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Dados inválidos.",
      fieldErrors: flatten(parsed),
    };
  }
  if (!canUseVehicleType(me, parsed.data.vehicle_type)) return { ok: false, error: VEHICLE_TYPE_DENIED };
  const statusError = manualStatusError(null, parsed.data.status, { isAdmin: me.role === "admin" });
  if (statusError) return { ok: false, error: statusError, fieldErrors: { status: statusError } };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const base = vehicleSlug(
    parsed.data.make,
    `${parsed.data.model}${parsed.data.variant ? " " + parsed.data.variant : ""}`,
    parsed.data.year,
  );
  const slug = await uniqueSlug(supabase, base);

  const row = { ...toRow(parsed.data), slug, created_by: user?.id ?? null };
  let { data, error } = await supabase.from("cars").insert(row).select("id, slug").single();
  if (error && withoutOlxFields(error.message)) {
    ({ data, error } = await supabase.from("cars").insert(stripOlxFields(row)).select("id, slug").single());
  }

  if (error || !data) {
    console.error("createCar:", error?.message);
    return { ok: false, error: error?.message ?? "Não foi possível criar a viatura." };
  }

  revalidatePublic(data.slug);
  // O anúncio do OLX acompanha a viatura (se tiver OLX marcado nos canais).
  await queueOlxSync([data.id]);
  // Viatura nova (ou publicada): o aviso à equipa foi agendado pela base de dados.
  deliverNotificationsSoon();
  return { ok: true, id: data.id, slug: data.slug };
}

export async function updateCar(
  id: string,
  input: unknown,
): Promise<SaveResult> {
  const me = await requireSection("carros");
  const parsed = carFormSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Dados inválidos.",
      fieldErrors: flatten(parsed),
    };
  }

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("cars")
    .select("status, vehicle_type")
    .eq("id", id)
    .maybeSingle();
  if (!current) return { ok: false, error: "Viatura não encontrada." };
  // O tipo atual e o novo: quem só tem motas não transforma um carro em mota.
  if (!canUseVehicleType(me, current.vehicle_type) || !canUseVehicleType(me, parsed.data.vehicle_type))
    return { ok: false, error: VEHICLE_TYPE_DENIED };
  const statusError = await statusChangeError(supabase, me, id, current.status, parsed.data.status);
  if (statusError) return { ok: false, error: statusError, fieldErrors: { status: statusError } };
  const row = toRow(parsed.data);
  let { data, error } = await supabase
    .from("cars")
    .update(row)
    .eq("id", id)
    .select("id, slug")
    .single();
  if (error && withoutOlxFields(error.message)) {
    ({ data, error } = await supabase
      .from("cars")
      .update(stripOlxFields(row))
      .eq("id", id)
      .select("id, slug")
      .single());
  }

  if (error || !data) {
    console.error("updateCar:", error?.message);
    return { ok: false, error: error?.message ?? "Não foi possível guardar a viatura." };
  }

  revalidatePublic(data.slug);
  // O anúncio do OLX acompanha a viatura (se tiver OLX marcado nos canais).
  await queueOlxSync([data.id]);
  // Se foi publicada pela primeira vez, há aviso à equipa.
  deliverNotificationsSoon();
  return { ok: true, id: data.id, slug: data.slug };
}

/**
 * Colunas recentes (0032 `olx_attributes`, 0034 `badges`): sem a migração a
 * viatura grava na mesma, só sem elas — em vez de a ficha deixar de gravar.
 */
function withoutOlxFields(message: string): boolean {
  return /olx_attributes|badges/.test(message);
}
function stripOlxFields<T extends { olx_attributes?: unknown; badges?: unknown }>(row: T): Omit<T, "olx_attributes" | "badges"> {
  const { olx_attributes: _a, badges: _b, ...rest } = row;
  void _a;
  void _b;
  return rest;
}

/** Erro da mudança de estado de uma viatura (ver `manualStatusError`). */
async function statusChangeError(
  db: Db,
  me: ProfileRow,
  id: string,
  from: CarStatus,
  to: CarStatus,
): Promise<string | null> {
  if (from === to) return null;
  const state = await salesState(db, [id]);
  return manualStatusError(from, to, {
    isAdmin: me.role === "admin",
    saleRecorded: state.saleRecorded(id),
    activeReservation: state.activeReservation(id),
  });
}

export async function setCarStatus(
  id: string,
  status: CarStatus,
): Promise<SaveResult> {
  const me = await requireSection("carros");
  const supabase = await createClient();
  const { data: current } = await supabase
    .from("cars")
    .select("status, vehicle_type")
    .eq("id", id)
    .maybeSingle();
  if (!current) return { ok: false, error: "Viatura não encontrada." };
  if (!canUseVehicleType(me, current.vehicle_type)) return { ok: false, error: VEHICLE_TYPE_DENIED };
  const statusError = await statusChangeError(supabase, me, id, current.status, status);
  if (statusError) return { ok: false, error: statusError };
  const { data, error } = await supabase
    .from("cars")
    .update({ status })
    .eq("id", id)
    .select("slug")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePublic(data.slug);
  // Vendida sai do OLX; publicada volta a entrar.
  await queueOlxSync([id]);
  deliverNotificationsSoon();
  return { ok: true };
}

export async function toggleFeatured(
  id: string,
  featured: boolean,
): Promise<SaveResult> {
  const me = await requireSection("carros");
  const supabase = await createClient();
  const denied = await carTypesError(supabase, me, [id]);
  if (denied) return { ok: false, error: denied };
  const { data, error } = await supabase
    .from("cars")
    .update({ featured })
    .eq("id", id)
    .select("slug")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePublic(data.slug);
  return { ok: true };
}

/** Duplica um carro como rascunho (sem media, sem destaque). */
export async function duplicateCar(id: string): Promise<SaveResult> {
  const me = await requireSection("carros");
  const supabase = await createClient();
  const { data: src, error: readErr } = await supabase
    .from("cars")
    .select("*")
    .eq("id", id)
    .single();
  if (readErr || !src) return { ok: false, error: "Viatura não encontrada." };
  if (!canUseVehicleType(me, src.vehicle_type)) return { ok: false, error: VEHICLE_TYPE_DENIED };

  const base = vehicleSlug(
    src.make,
    `${src.model} copia`,
    src.year ?? new Date().getFullYear(),
  );
  const slug = await uniqueSlug(supabase, base);

  /* eslint-disable @typescript-eslint/no-unused-vars */
  const {
    id: _id,
    created_at: _c,
    updated_at: _u,
    published_at: _p,
    sold_at: _s,
    ...rest
  } = src;
  /* eslint-enable @typescript-eslint/no-unused-vars */

  const { data, error } = await supabase
    .from("cars")
    .insert({
      ...rest,
      slug,
      status: "draft",
      featured: false,
      tagline: src.tagline ? `${src.tagline}` : null,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePublic();
  deliverNotificationsSoon();
  return { ok: true, id: data.id };
}

/** Mensagem para uma viatura que não se apaga por ter histórico comercial. */
function historyMessage(status: CarStatus): string {
  return status === "sold"
    ? "está vendida, com a venda registada: fica no histórico de vendas e não se apaga."
    : "tem reservas ou uma venda registadas: o histórico tem de ficar, por isso não se apaga. Para a tirar do site, passe-a a rascunho.";
}

/** O erro da base de dados quando a viatura tem histórico (0047, ou as chaves). */
const HISTORY_ERROR = /reservas ou venda registadas|reservations_car_id_fkey|Não pode trocar a viatura|foreign key/i;

interface DeleteOutcome {
  deleted: string[];
  failed: { label: string; reason: string }[];
}

/**
 * Apaga viaturas, uma a uma. Primeiro verifica o histórico (reservas e
 * vendas); depois apaga; e só com a viatura apagada tira o anúncio do OLX e os
 * ficheiros. Antes o OLX era retirado primeiro: se o apagar falhasse, a viatura
 * ficava no site e desaparecia do OLX.
 */
async function deleteCars(supabase: Db, me: ProfileRow, ids: string[]): Promise<DeleteOutcome> {
  const out: DeleteOutcome = { deleted: [], failed: [] };
  const { data: cars } = await supabase
    .from("cars")
    .select("id, make, model, status, vehicle_type")
    .in("id", ids);
  const state = await salesState(supabase, ids);
  for (const id of ids) {
    const car = cars?.find((c) => c.id === id);
    if (!car) {
      out.failed.push({ label: "Viatura", reason: "não foi encontrada." });
      continue;
    }
    const label = carLabel(car);
    if (!canUseVehicleType(me, car.vehicle_type)) {
      out.failed.push({ label, reason: "é de um tipo de viatura a que não tem acesso." });
      continue;
    }
    if (state.hasHistory(id)) {
      out.failed.push({ label, reason: historyMessage(car.status) });
      continue;
    }
    const { data: media } = await supabase.from("car_media").select("storage_path").eq("car_id", id);
    const paths = (media ?? []).map((m) => m.storage_path).filter((p) => !/^https?:\/\//i.test(p));
    // Lidos antes: ao apagar, a ligação ao anúncio desaparece em cascata.
    const adverts = await olxAdvertIds([id]);
    const { data: gone, error } = await supabase.from("cars").delete().eq("id", id).select("id");
    if (error || !gone?.length) {
      if (error) console.error("deleteCar:", error.message);
      out.failed.push({
        label,
        reason: error && HISTORY_ERROR.test(error.message)
          ? historyMessage(car.status)
          : error ? "não foi possível apagar." : "não foi apagada (sem permissão).",
      });
      continue;
    }
    out.deleted.push(id);
    await retireOlxAdverts(adverts);
    if (paths.length) {
      const { error: cleanupError } = await supabase.storage.from(MEDIA_BUCKET).remove(paths);
      if (cleanupError) console.error("Car media cleanup:", cleanupError.message);
    }
  }
  return out;
}

/** «2 viaturas apagadas.» / «Não foi possível apagar: BMW 320 — …». */
function deleteSummary(out: DeleteOutcome): SaveResult {
  const n = out.deleted.length;
  const done = n ? `${n} ${n === 1 ? "viatura apagada" : "viaturas apagadas"}.` : "";
  if (!out.failed.length) return { ok: true, message: done || undefined };
  const why = out.failed.map((f) => `${f.label} ${f.reason}`).join(" ");
  return { ok: false, error: `${done ? `${done} ` : ""}${n ? "Não apagadas: " : "Não foi possível apagar: "}${why}` };
}

/** Apaga um carro e a sua media (BD + objetos no Storage). */
export async function deleteCar(id: string): Promise<SaveResult> {
  const me = await requireSection("carros");
  const supabase = await createClient();
  const out = await deleteCars(supabase, me, [id]);
  if (out.deleted.length) revalidatePublic();
  if (out.failed.length) return { ok: false, error: `Esta viatura ${out.failed[0]!.reason}` };
  return { ok: true };
}

// ---- Ações em lote --------------------------------------------------------
/**
 * Publicar ou passar a rascunho várias de uma vez. As que não podem mudar
 * (vendidas, reservadas, de outro tipo) ficam como estavam e o resumo diz
 * porquê; as outras mudam.
 */
export async function bulkSetStatus(
  ids: string[],
  status: CarStatus,
): Promise<SaveResult> {
  const me = await requireSection("carros");
  if (!ids.length) return { ok: true };
  const supabase = await createClient();
  const { data: cars } = await supabase
    .from("cars")
    .select("id, make, model, status, vehicle_type")
    .in("id", ids);
  const state = await salesState(supabase, ids);
  const allowed: string[] = [];
  const refused: string[] = [];
  for (const car of cars ?? []) {
    if (car.status === status) continue;
    const reason = !canUseVehicleType(me, car.vehicle_type)
      ? VEHICLE_TYPE_DENIED
      : manualStatusError(car.status, status, {
          isAdmin: me.role === "admin",
          saleRecorded: state.saleRecorded(car.id),
          activeReservation: state.activeReservation(car.id),
        });
    if (reason) refused.push(`${carLabel(car)}: ${reason}`);
    else allowed.push(car.id);
  }
  if (allowed.length) {
    const { error } = await supabase
      .from("cars")
      .update({ status })
      .in("id", allowed);
    if (error) return { ok: false, error: error.message };
    revalidatePublic();
    await queueOlxSync(allowed);
    // Publicar em lote: o envio junta-as numa mensagem por pessoa.
    deliverNotificationsSoon();
  }
  if (!refused.length) return { ok: true };
  const n = allowed.length;
  return {
    ok: false,
    error: `${n ? `${n} ${n === 1 ? "viatura atualizada" : "viaturas atualizadas"}. ` : ""}Ficaram como estavam — ${refused.join(" ")}`,
  };
}

export async function bulkDelete(ids: string[]): Promise<SaveResult> {
  const me = await requireSection("carros");
  if (!ids.length) return { ok: true };
  const supabase = await createClient();
  const out = await deleteCars(supabase, me, ids);
  if (out.deleted.length) revalidatePublic();
  return deleteSummary(out);
}

function flatten(
  parsed: ReturnType<typeof carFormSchema.safeParse> & { success: false },
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
