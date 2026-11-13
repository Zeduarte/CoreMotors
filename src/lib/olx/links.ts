import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { olxFetch } from "@/lib/olx/client";
import { unwrap } from "@/lib/olx/categories";
import { suggestAll, type Suggestion } from "@/lib/olx/adverts";
import { markPending, syncListing } from "@/lib/olx/sync";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Associar os anúncios da conta do OLX às viaturas, e o que se pode fazer a um
 * anúncio na lista do painel. As Server Actions (`actions/olx-adverts.ts`)
 * verificam quem pede e chamam isto com o cliente de serviço.
 *
 * Associar só liga as duas coisas: o backoffice passa a mandar no anúncio
 * quando a viatura está publicada com OLX marcado (a sincronização adota-o).
 */

type Db = SupabaseClient<Database>;

export interface LinkResult {
  ok: boolean;
  error?: string;
  message?: string;
}

const NOT_FOUND = "Anúncio não encontrado. Carregue em «Ler anúncios do OLX» e tente outra vez.";

/** Viaturas que já têm um anúncio: associado no espelho ou criado pelo site. */
async function linkedCarIds(db: Db): Promise<Set<string>> {
  const [{ data: adverts }, { data: listings }] = await Promise.all([
    db.from("olx_adverts").select("id, car_id"),
    db.from("channel_listings").select("car_id, external_id").eq("channel", "olx").not("external_id", "is", null),
  ]);
  const advertIds = new Set((adverts ?? []).map((a) => String(a.id)));
  const ids = new Set((adverts ?? []).map((a) => a.car_id).filter((c): c is string => !!c));
  for (const l of listings ?? []) if (l.external_id && advertIds.has(l.external_id)) ids.add(l.car_id);
  return ids;
}

export async function linkAdvert(db: Db, advertId: number, carId: string): Promise<LinkResult> {
  const { data: advert } = await db.from("olx_adverts").select("id, origin, car_id").eq("id", advertId).maybeSingle();
  if (!advert) return { ok: false, error: NOT_FOUND };
  if (advert.car_id) return { ok: false, error: "Este anúncio já está associado a uma viatura." };
  const { data: car } = await db.from("cars").select("id, channels, status").eq("id", carId).maybeSingle();
  if (!car) return { ok: false, error: "Viatura não encontrada." };
  if ((await linkedCarIds(db)).has(carId)) return { ok: false, error: "Esta viatura já tem um anúncio do OLX associado." };

  const { error } = await db.from("olx_adverts").update({ car_id: carId }).eq("id", advertId);
  if (error) return { ok: false, error: "Esta viatura já tem um anúncio do OLX associado." };

  // Com a viatura à venda e OLX marcado, o backoffice passa já a mandar no
  // anúncio (texto, fotos e preço da ficha). Num rascunho, ou nos do
  // Standvirtual, fica só associado: nada muda no OLX.
  const takesOver = (car.channels ?? []).includes("olx") && ["published", "reserved"].includes(car.status);
  if (takesOver && advert.origin !== "standvirtual") {
    await markPending(db, carId);
    const r = await syncListing(db, carId);
    return r.ok
      ? { ok: true, message: "Anúncio associado. Passou a ter o texto, as fotos e o preço da ficha." }
      : { ok: true, message: `Anúncio associado, mas o OLX recusou a atualização: ${r.error}` };
  }
  return { ok: true, message: "Anúncio associado à viatura." };
}

export async function unlinkAdvert(db: Db, advertId: number): Promise<LinkResult> {
  const { data: advert } = await db.from("olx_adverts").select("id, origin, car_id").eq("id", advertId).maybeSingle();
  if (!advert) return { ok: false, error: NOT_FOUND };
  if (!advert.car_id) return { ok: false, error: "Este anúncio não está associado a nenhuma viatura." };
  if (advert.origin === "site") {
    return { ok: false, error: "Este anúncio foi criado pelo backoffice: retira-se desmarcando OLX na ficha da viatura." };
  }
  const carId = advert.car_id;
  await db.from("olx_adverts").update({ car_id: null }).eq("id", advertId);

  if (advert.origin === "olx") {
    // A viatura deixa de mandar neste anúncio: sem OLX marcado, a sincronização
    // nem cria um anúncio novo nem desativa este.
    await db
      .from("channel_listings")
      .update({ external_id: null, external_url: null, remote_status: null, status: "pending", sync_state: "idle", last_error: null, notes: null })
      .eq("car_id", carId)
      .eq("channel", "olx");
    const { data: car } = await db.from("cars").select("channels").eq("id", carId).maybeSingle();
    if (car) await db.from("cars").update({ channels: (car.channels ?? []).filter((c) => c !== "olx") }).eq("id", carId);
    return { ok: true, message: "Anúncio desassociado. A viatura deixou de ter OLX marcado; o anúncio no OLX ficou como estava." };
  }
  await db.from("channel_listings").update({ notes: null }).eq("car_id", carId).eq("channel", "olx");
  return { ok: true, message: "Anúncio desassociado." };
}

/**
 * Sugestões para os anúncios por associar, contra as viaturas que ainda não
 * têm anúncio. `canUseType` limita às viaturas de quem pede.
 */
export async function currentSuggestions(
  db: Db,
  canUseType: (type: string | null | undefined) => boolean = () => true,
): Promise<Map<number, Suggestion>> {
  const [{ data: adverts }, { data: cars }, linked] = await Promise.all([
    db.from("olx_adverts").select("id, title, price, category_name").is("car_id", null),
    db.from("cars").select("id, make, model, price, vehicle_type"),
    linkedCarIds(db),
  ]);
  return suggestAll(
    (adverts ?? []).map((a) => ({ id: a.id, title: a.title, price: a.price, categoryName: a.category_name })),
    (cars ?? []).filter((c) => !linked.has(c.id) && canUseType(c.vehicle_type)),
  );
}

export async function confirmSuggestions(
  db: Db,
  canUseType: (type: string | null | undefined) => boolean = () => true,
): Promise<LinkResult> {
  const suggestions = await currentSuggestions(db, canUseType);
  let linked = 0;
  const errors: string[] = [];
  for (const [advertId, s] of suggestions) {
    if (!s.strong) continue;
    const r = await linkAdvert(db, advertId, s.carId);
    if (r.ok) linked += 1;
    else if (r.error) errors.push(r.error);
  }
  if (!linked && errors.length) return { ok: false, error: errors[0] };
  return { ok: true, message: linked ? `${linked} anúncio(s) associado(s).` : "Não havia sugestões por confirmar." };
}

export async function setAdvertActive(db: Db, advertId: number, active: boolean): Promise<LinkResult> {
  const { data: advert } = await db.from("olx_adverts").select("id, origin, car_id").eq("id", advertId).maybeSingle();
  if (!advert) return { ok: false, error: NOT_FOUND };
  if (advert.origin === "standvirtual") {
    return { ok: false, error: "Este anúncio vem do Standvirtual: ativa-se e desativa-se lá." };
  }
  if (advert.car_id) {
    const { data: car } = await db.from("cars").select("channels").eq("id", advert.car_id).maybeSingle();
    // A sincronização desfazia a ação: o estado segue o da viatura.
    if ((car?.channels ?? []).includes("olx")) {
      return { ok: false, error: "Este anúncio é gerido pela ficha da viatura: o estado muda-se lá." };
    }
  }
  const r = await olxFetch(db, `/adverts/${advertId}/commands`, {
    method: "POST",
    body: active ? { command: "activate" } : { command: "deactivate", is_success: false },
  });
  if (!r.ok) return { ok: false, error: r.error ?? "O OLX recusou o pedido." };
  const g = await olxFetch<unknown>(db, `/adverts/${advertId}`);
  const status = g.ok ? unwrap<{ status?: string }>(g.data)?.status : null;
  if (status) await db.from("olx_adverts").update({ status }).eq("id", advertId);
  return { ok: true, message: active ? "Anúncio ativado." : "Anúncio desativado." };
}
