import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "@/lib/olx/categories";
import { getConnection, olxFetch } from "@/lib/olx/client";
import { advertOrigin } from "@/lib/olx/adverts";
import { parseStats } from "@/lib/olx/stats";
import type { Database, OlxAdvertRow } from "@/lib/supabase/database.types";

/**
 * «Ler anúncios do OLX»: traz para `olx_adverts` todos os anúncios da conta
 * ligada — os do site, os feitos à mão no OLX e os do Standvirtual.
 *
 * Só apaga ou limpa depois de uma leitura completa: uma página que falhe a
 * meio não pode fazer desaparecer anúncios que existem. Nunca lança.
 */

type Db = SupabaseClient<Database>;

export const PAGE = 100;
/** 5 000 anúncios: muito acima de um stand; trava uma paginação que não acabe. */
const MAX_PAGES = 50;

export const OTHER_ACCOUNT_NOTE =
  "O anúncio anterior não está na conta do OLX ligada (era de outra conta ou foi apagado). Grave a viatura para o publicar nesta conta.";

export interface ImportResult {
  ok: boolean;
  read: number;
  removed: number;
  cleared: number;
  stats: number;
  error?: string;
}

interface ListedAdvert {
  id: number;
  status: string;
  title?: string;
  url?: string | null;
  external_id?: string | null;
  category_id?: number | null;
  price?: { value?: string | number | null } | null;
  valid_to?: string | null;
  created_at?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** As datas do OLX vêm como «2026-12-01 10:00:00» (hora de Portugal). */
function olxDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v.includes("T") ? v : v.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function priceOf(a: ListedAdvert): number | null {
  const n = Number(a.price?.value);
  return a.price?.value == null || !Number.isFinite(n) ? null : n;
}

export async function importAdverts(db: Db, opts: { stats: boolean }): Promise<ImportResult> {
  const result: ImportResult = { ok: true, read: 0, removed: 0, cleared: 0, stats: 0 };
  try {
    if (!(await getConnection(db))) return { ...result, ok: false, error: "A conta do OLX não está ligada." };

    // 1) Tudo, página a página. Uma página com erro termina sem mexer em nada.
    const all: ListedAdvert[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await olxFetch<unknown>(db, `/adverts?offset=${page * PAGE}&limit=${PAGE}`);
      if (!r.ok) return { ...result, ok: false, error: r.error ?? "Não foi possível ler os anúncios do OLX." };
      const list = unwrap<ListedAdvert[]>(r.data) ?? [];
      all.push(...list);
      if (list.length < PAGE) break;
    }
    result.read = all.length;
    const seen = new Set(all.map((a) => a.id));

    // 2) O que já se sabe: associações e nomes das categorias.
    const { data: existing } = await db.from("olx_adverts").select("id, car_id, category_id, category_name");
    const known = new Map((existing ?? []).map((r) => [r.id, r]));
    const categoryNames = new Map<number, string | null>();
    for (const r of existing ?? []) if (r.category_id && r.category_name) categoryNames.set(r.category_id, r.category_name);
    for (const id of new Set(all.map((a) => a.category_id).filter((c): c is number => !!c))) {
      if (categoryNames.has(id)) continue;
      const c = await olxFetch<unknown>(db, `/categories/${id}`);
      categoryNames.set(id, c.ok ? unwrap<{ name?: string }>(c.data)?.name ?? null : null);
    }

    // Os anúncios criados pelo site levam o id da viatura em `external_id`.
    const uuids = [...new Set(all.map((a) => a.external_id).filter((e): e is string => !!e && UUID.test(e)))];
    const { data: cars } = uuids.length ? await db.from("cars").select("id").in("id", uuids) : { data: [] as { id: string }[] };
    const siteIds = new Set((cars ?? []).map((c) => c.id));
    const linkedCars = new Set((existing ?? []).map((r) => r.car_id).filter(Boolean));

    const now = new Date().toISOString();
    const rows: Partial<OlxAdvertRow>[] = all.map((a) => {
      const origin = advertOrigin(a.external_id, siteIds);
      const row: Partial<OlxAdvertRow> = {
        id: a.id,
        origin,
        status: a.status,
        title: a.title ?? "",
        url: a.url ?? null,
        external_id: a.external_id || null,
        price: priceOf(a),
        category_id: a.category_id ?? null,
        category_name: a.category_id ? categoryNames.get(a.category_id) ?? null : null,
        valid_to: olxDate(a.valid_to),
        olx_created_at: olxDate(a.created_at),
        seen_at: now,
      };
      // Um anúncio do site fica associado à sua viatura, se ninguém o fez antes.
      const prev = known.get(a.id);
      if (origin === "site" && !prev?.car_id && !linkedCars.has(a.external_id!)) {
        row.car_id = a.external_id!;
        linkedCars.add(a.external_id!);
      }
      return row;
    });
    if (rows.length) {
      const { error } = await db.from("olx_adverts").upsert(rows as OlxAdvertRow[]);
      if (error) return { ...result, ok: false, error: error.message };
    }

    // 3) O que já não está na conta sai do espelho.
    const gone = (existing ?? []).map((r) => r.id).filter((id) => !seen.has(id));
    if (gone.length) {
      await db.from("olx_adverts").delete().in("id", gone);
      result.removed = gone.length;
    }

    // 4) Anúncios de outra conta (ou apagados) deixam de estar associados às
    //    viaturas. Só com a confirmação do OLX: 404 (não existe) ou 403 (não é
    //    desta conta). Um erro passageiro não limpa nada.
    const { data: listings } = await db
      .from("channel_listings")
      .select("id, external_id")
      .eq("channel", "olx")
      .not("external_id", "is", null);
    for (const l of listings ?? []) {
      if (seen.has(Number(l.external_id))) continue;
      const g = await olxFetch<unknown>(db, `/adverts/${l.external_id}`);
      if (g.status !== 404 && g.status !== 403) continue;
      await db
        .from("channel_listings")
        .update({
          external_id: null,
          external_url: null,
          remote_status: null,
          views: null,
          phone_views: null,
          observers: null,
          stats_at: null,
          status: "pending",
          sync_state: "idle",
          attempts: 0,
          last_error: OTHER_ACCOUNT_NOTE,
        })
        .eq("id", l.id);
      result.cleared += 1;
    }

    // 5) Estatísticas de todos, copiadas também para a viatura associada.
    if (opts.stats) {
      const { data: links } = await db.from("olx_adverts").select("id, car_id");
      const carOf = new Map((links ?? []).map((r) => [r.id, r.car_id]));
      for (const a of all) {
        const r = await olxFetch<unknown>(db, `/adverts/${a.id}/statistics`);
        if (!r.ok) continue;
        const s = parseStats(r.data);
        const stats = { views: s.views, phone_views: s.phoneViews, observers: s.observers, stats_at: new Date().toISOString() };
        await db.from("olx_adverts").update(stats).eq("id", a.id);
        const carId = carOf.get(a.id);
        if (carId) await db.from("channel_listings").update(stats).eq("car_id", carId).eq("channel", "olx");
        result.stats += 1;
      }
    }
    return result;
  } catch (error) {
    console.error("olx importAdverts:", error);
    return { ...result, ok: false, error: error instanceof Error ? error.message : "Falha inesperada." };
  }
}
