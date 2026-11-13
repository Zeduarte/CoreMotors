import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "@/lib/olx/categories";
import { getConnection, olxFetch } from "@/lib/olx/client";
import { advertOrigin, isLiveAdvert } from "@/lib/olx/adverts";
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

/** Estatísticas de cada anúncio, no máximo uma vez a cada 20 h, 50 por vez. */
const STATS_EVERY_MS = 20 * 60 * 60 * 1000;
const STATS_PER_RUN = 50;

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

/**
 * Ligou-se outra conta do OLX: os anúncios (e as associações) da anterior não
 * são desta, por isso o espelho fica vazio até à próxima leitura. A primeira
 * ligação, ou voltar a ligar a mesma conta, não mexe em nada.
 */
export async function resetForAccount(db: Db, previousUserId: string | null, newUserId: string | null): Promise<boolean> {
  if (!previousUserId || !newUserId || previousUserId === newUserId) return false;
  await db.from("olx_adverts").delete().not("id", "is", null);
  return true;
}

/**
 * `stats`: false (só a lista — o retorno do OAuth), "due" (a manutenção) ou
 * "all" (o botão «Ler anúncios do OLX»).
 */
export async function importAdverts(
  db: Db,
  opts: { stats: false | "due" | "all"; maxStats?: number },
): Promise<ImportResult> {
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

    // 2) O que já se sabe: associações, origens e nomes das categorias. Sem
    //    isto não se grava nada (as associações ficavam por conta de um palpite).
    const { data: existing, error: readError } = await db
      .from("olx_adverts")
      .select("id, car_id, origin, category_id, category_name, stats_at");
    if (readError || !existing) return { ...result, ok: false, error: readError?.message ?? "Não foi possível ler os anúncios guardados." };
    const known = new Map(existing.map((r) => [r.id, r]));
    const categoryNames = new Map<number, string | null>();
    for (const r of existing) if (r.category_id && r.category_name) categoryNames.set(r.category_id, r.category_name);
    for (const id of new Set(all.map((a) => a.category_id).filter((c): c is number => !!c))) {
      if (categoryNames.has(id)) continue;
      const c = await olxFetch<unknown>(db, `/categories/${id}`);
      categoryNames.set(id, c.ok ? unwrap<{ name?: string }>(c.data)?.name ?? null : null);
    }

    // `car_id` nunca vai no lote: num upsert de várias linhas, a coluna que
    // falta numa linha é gravada a NULL, e apagava as associações já feitas.
    const now = new Date().toISOString();
    const rows: Partial<OlxAdvertRow>[] = all.map((a) => ({
      id: a.id,
      origin: advertOrigin(a.external_id, known.get(a.id)?.origin),
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
    }));
    // Um anúncio novo do site fica associado à sua viatura, se ela existir e
    // ainda não tiver anúncio — lida antes de gravar, para uma falha não deixar
    // nada a meio. Depois, um a um e só onde ainda não há associação, para não
    // desfazer uma feita entretanto no painel.
    const linkedCars = new Set(existing.map((r) => r.car_id).filter(Boolean));
    const candidates = rows.filter(
      (r) => r.origin === "site" && !known.get(r.id!)?.car_id && r.external_id && !linkedCars.has(r.external_id),
    );
    let carIds = new Set<string>();
    if (candidates.length) {
      const { data: cars, error } = await db
        .from("cars")
        .select("id")
        .in("id", [...new Set(candidates.map((r) => r.external_id!))]);
      if (error) return { ...result, ok: false, error: error.message };
      carIds = new Set((cars ?? []).map((c) => c.id));
    }

    if (rows.length) {
      const { error } = await db.from("olx_adverts").upsert(rows as OlxAdvertRow[]);
      if (error) return { ...result, ok: false, error: error.message };
    }

    for (const r of candidates) {
      if (!carIds.has(r.external_id!) || linkedCars.has(r.external_id!)) continue;
      await db.from("olx_adverts").update({ car_id: r.external_id! }).eq("id", r.id!).is("car_id", null);
      linkedCars.add(r.external_id!);
    }

    // 3) O que já não está na conta sai do espelho.
    const gone = existing.map((r) => r.id).filter((id) => !seen.has(id));
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

    // 5) Estatísticas, copiadas também para a viatura associada. «all» (o
    //    botão) lê todas; «due» (a manutenção, de 15 em 15 minutos) só as dos
    //    anúncios à vista lidas há mais de 20 h, num lote limitado.
    if (opts.stats) {
      const { data: links } = await db.from("olx_adverts").select("id, car_id, stats_at");
      const byId = new Map((links ?? []).map((r) => [r.id, r]));
      const limite = Date.now() - STATS_EVERY_MS;
      const due = all
        .filter((a) => {
          if (opts.stats === "all") return true;
          // Sem data (nunca lidas) contam como antigas.
          const lidas = Date.parse(byId.get(a.id)?.stats_at ?? "");
          return isLiveAdvert(a.status) && !(lidas > limite);
        })
        .slice(0, opts.stats === "all" ? all.length : opts.maxStats ?? STATS_PER_RUN);
      for (const a of due) {
        const r = await olxFetch<unknown>(db, `/adverts/${a.id}/statistics`);
        if (!r.ok) continue;
        const s = parseStats(r.data);
        const stats = { views: s.views, phone_views: s.phoneViews, observers: s.observers, stats_at: new Date().toISOString() };
        await db.from("olx_adverts").update(stats).eq("id", a.id);
        const carId = byId.get(a.id)?.car_id;
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
