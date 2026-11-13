// OLX simulado (Partner API v2) e base de dados em memória com a parte da API
// do Supabase que o código do OLX usa. Para os testes dos anúncios da conta
// (`tests/olx-adverts.test.mjs`); o molde é o de `tests/olx-flow.test.mjs`.
import http from 'node:http';

const SV_REFUSAL = {
  error: {
    status: 400, title: 'Invalid request', detail: 'Data validation error occurred',
    validation: [{ field: 'user', title: 'Anúncio exportado do  Standvirtual. Para alterá-lo, necessita de aceder à sua conta.', detail: 'Anúncio exportado do  Standvirtual. Para alterá-lo, necessita de aceder à sua conta.' }],
  },
};

/**
 * Cada anúncio guardado em `olx.adverts` tem os campos do OLX e, só para o
 * simulado, `_standvirtual` (o OLX recusa alterá-lo), `_owner` (outra conta:
 * 403) e `_views`. O que começa por `_` não sai nas respostas.
 */
export async function startFakeOlx() {
  const olx = {
    adverts: new Map(), categories: new Map(), attributes: new Map(), calls: [],
    token: 'tok-1', refresh: 'ref-1', failPage: null, failGet: new Set(), next: 900000, userId: 222,
    images: new Map(),
  };
  const pub = (ad) => Object.fromEntries(Object.entries(ad).filter(([k]) => !k.startsWith('_')));
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : null;
    const url = new URL(req.url, 'http://x');
    olx.calls.push(`${req.method} ${url.pathname}${url.search}`);
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    const img = url.pathname.match(/^\/img\/(.+)$/);
    if (img) {
      const f = olx.images.get(img[1]);
      if (!f) return send(404, {});
      res.writeHead(200, { 'Content-Type': f.type }); return res.end(f.bytes);
    }
    if (url.pathname === '/api/open/oauth/token') {
      olx.token = `tok-${olx.calls.length}`; olx.refresh = `ref-${olx.calls.length}`;
      return send(200, { access_token: olx.token, refresh_token: olx.refresh, expires_in: 86400 });
    }
    if (req.headers.version !== '2.0') return send(400, { error: { detail: "Missing required 'Version' header!" } });
    if (req.headers.authorization !== `Bearer ${olx.token}`) return send(401, { error: 'invalid_token' });
    if (url.pathname === '/api/partner/users/me') return send(200, { data: { id: olx.userId, name: 'Supermotas' } });
    if (url.pathname === '/api/partner/locations') return send(200, { data: [{ city: { id: 12, name: 'Penafiel' }, district: { id: 3 } }] });
    const cat = url.pathname.match(/^\/api\/partner\/categories\/(\d+)(\/attributes)?$/);
    if (cat && req.method === 'GET') {
      if (cat[2]) return send(200, { data: olx.attributes.get(Number(cat[1])) ?? [] });
      const c = olx.categories.get(Number(cat[1]));
      return c ? send(200, { data: c }) : send(404, { error: { detail: 'Category not found' } });
    }
    const st = url.pathname.match(/^\/api\/partner\/adverts\/(\d+)\/statistics$/);
    if (st && req.method === 'GET') {
      const ad = olx.adverts.get(Number(st[1])); if (!ad) return send(404, { error: { detail: 'Advert not found' } });
      return send(200, { data: { advert_views: ad._views ?? 10, phone_views: 1, users_observing: 2 } });
    }
    const m = url.pathname.match(/^\/api\/partner\/adverts(?:\/(\d+))?(\/commands)?$/);
    if (m && !m[1] && req.method === 'GET') {
      const ext = url.searchParams.get('external_id');
      // `_hidden`: existe (o GET dele dá 200) mas ainda não aparece na lista.
      const mine = [...olx.adverts.values()].filter((a) => !a._owner && !a._hidden);
      if (ext !== null) return send(200, { data: mine.filter((a) => a.external_id === ext).map(pub) });
      const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 50);
      if (olx.failPage && offset / limit + 1 === olx.failPage) return send(500, { error: { detail: 'Internal error' } });
      return send(200, { data: mine.slice(offset, offset + limit).map(pub) });
    }
    if (m && !m[1] && req.method === 'POST') {
      const id = olx.next++; const ad = { ...body, id, status: 'active', url: `https://www.olx.pt/d/anuncio/${id}` };
      olx.adverts.set(id, ad); return send(200, { data: pub(ad) });
    }
    if (m && m[1]) {
      const id = Number(m[1]);
      if (olx.failGet.has(id)) return send(500, { error: { detail: 'Internal error' } });
      const ad = olx.adverts.get(id);
      if (!ad) return send(404, { error: { status: 404, title: 'Not Found', detail: 'Advert not found' } });
      if (ad._owner) return send(403, { error: { status: 403, title: 'Forbidden', detail: "You're not the owner of this advert" } });
      if (req.method === 'GET' && !m[2]) return send(200, { data: pub(ad) });
      if (ad._standvirtual) return send(400, SV_REFUSAL);
      if (req.method === 'PUT' && !m[2]) { Object.assign(ad, body); return send(200, { data: pub(ad) }); }
      if (m[2]) {
        if (body.command === 'deactivate') { ad.status = 'removed_by_user'; ad._sold = body.is_success; }
        if (body.command === 'activate') ad.status = 'active';
        return send(204);
      }
    }
    send(404, { error: { detail: 'not simulated' } });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { olx, url, close: () => new Promise((r) => server.close(r)) };
}

/** Escritas feitas ao OLX (para provar que nada foi enviado). */
export const writes = (olx) => olx.calls.filter((c) => !c.startsWith('GET ') && !c.includes('/oauth/'));

const KEYS = { olx_adverts: 'id', olx_category_details: 'category_id', olx_category_cache: 'vehicle_type', olx_connection: 'id' };
const DEFAULTS = {
  channel_listings: () => ({ sync_state: 'idle', attempts: 0, status: 'pending', external_id: null, external_url: null, remote_status: null,
    last_error: null, published_at: null, last_synced_at: null, notes: null, views: null, phone_views: null, observers: null, stats_at: null }),
  olx_adverts: () => ({ car_id: null, url: null, external_id: null, price: null, category_id: null, category_name: null, valid_to: null,
    olx_created_at: null, views: null, phone_views: null, observers: null, stats_at: null, seen_at: new Date().toISOString() }),
  car_media: () => ({ alt: null, width: null, height: null }),
};

/** Base de dados em memória: `from(tabela)` com os filtros que o código usa. */
export function makeDb(tables) {
  const t = { channel_listings: [], olx_adverts: [], car_media: [], cars: [], olx_category_cache: [], olx_category_details: [], ...tables };
  let seq = 1;
  const storage = { uploads: [], removed: [] };
  // Leituras que falham: tabela → erro do Supabase (ver `failRead`).
  const failSelect = new Map();
  // Escritas que falham: 'update:tabela' / 'insert:tabela' → erro.
  const failWrite = new Map();
  const from = (table) => {
    t[table] ??= [];
    const f = []; let op = 'select', patch = null, lim = Infinity, payload = null;
    const rows = () => t[table].filter((r) => f.every((fn) => fn(r)));
    const shape = (r) => (table === 'cars' ? { ...r, car_media: t.car_media.filter((m) => m.car_id === r.id) } : { ...r });
    const withDefaults = (row) => ({ ...(DEFAULTS[table]?.() ?? {}), ...(table === 'channel_listings' || table === 'car_media' ? { id: `l${seq++}` } : {}), ...row });
    const unique = (row) => table === 'olx_adverts' && row.car_id && t.olx_adverts.some((r) => r.car_id === row.car_id && r.id !== row.id);
    const run = () => {
      if (op === 'update') {
        if (failWrite.has(`update:${table}`)) return { data: null, error: failWrite.get(`update:${table}`) };
        const rs = rows();
        if (rs.some((r) => unique({ ...r, ...patch }))) return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
        rs.forEach((r) => Object.assign(r, patch)); return { data: rs.map(shape), error: null };
      }
      if (op === 'delete') { const keep = t[table].filter((r) => !f.every((fn) => fn(r))); const n = t[table].length - keep.length; t[table] = keep; return { data: n, error: null }; }
      if (op === 'insert') {
        if (failWrite.has(`insert:${table}`)) return { data: null, error: failWrite.get(`insert:${table}`) };
        const list = (Array.isArray(payload) ? payload : [payload]).map(withDefaults);
        if (list.some(unique)) return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
        t[table].push(...list); return { data: list.map(shape), error: null };
      }
      if (op === 'upsert') {
        const key = KEYS[table];
        // Como o PostgREST: um lote leva a união das colunas de todas as linhas,
        // e a coluna que falta numa linha é gravada a NULL (também por cima do
        // valor que já lá estava).
        const list = Array.isArray(payload) ? payload : [payload];
        const cols = [...new Set(list.flatMap((r) => Object.keys(r)))];
        const full = list.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] === undefined ? null : r[c]])));
        for (const row of full) {
          if (unique(row)) return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
          const i = t[table].findIndex((r) => r[key] === row[key]);
          if (i >= 0) t[table][i] = { ...t[table][i], ...row }; else t[table].push(withDefaults(row));
        }
        return { data: null, error: null };
      }
      if (failSelect.has(table)) return { data: null, error: failSelect.get(table) };
      return { data: rows().slice(0, lim).map(shape), error: null };
    };
    const api = {
      select() { return api; },
      eq(c, v) { f.push((r) => r[c] === v); return api; },
      neq(c, v) { f.push((r) => r[c] !== v); return api; },
      in(c, v) { f.push((r) => v.includes(r[c])); return api; },
      is(c, v) { f.push((r) => (r[c] ?? null) === v); return api; },
      not(c, o, v) { f.push(o === 'is' && v === null ? (r) => r[c] !== null && r[c] !== undefined : (r) => r[c] !== v); return api; },
      lt(c, v) { f.push((r) => r[c] < v); return api; },
      order() { return api; },
      limit(n) { lim = n; return api; },
      update(p) { op = 'update'; patch = p; return api; },
      delete() { op = 'delete'; return api; },
      insert(p) { op = 'insert'; payload = p; return api; },
      upsert(p) { op = 'upsert'; payload = p; return api; },
      async maybeSingle() { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; },
      async single() { const r = run(); const d = Array.isArray(r.data) ? r.data[0] ?? null : r.data; return { data: d, error: r.error ?? (d ? null : { message: 'no rows' }) }; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return api;
  };
  const bucket = () => ({
    async upload(path, bytes, opts) { storage.uploads.push({ path, size: bytes.byteLength ?? bytes.length, opts }); return { data: { path }, error: null }; },
    async remove(paths) { storage.removed.push(...paths); return { data: null, error: null }; },
  });
  return { from, storage: { from: bucket }, _t: t, _storage: storage, _failSelect: failSelect, _failWrite: failWrite };
}

/** Uma ligação ao OLX válida para o token atual do simulado. */
export const connectionRow = (olx) => ({
  id: 1, access_token: olx.token, refresh_token: olx.refresh, expires_at: new Date(Date.now() + 86400e3).toISOString(),
  city_id: 17, olx_user_id: String(olx.userId), updated_at: new Date().toISOString(),
});

/** Um erro qualquer do Supabase, e o de uma tabela que ainda não existe (migração por aplicar). */
export const READ_ERROR = { message: 'canceling statement due to statement timeout', code: '57014' };
export const MISSING_TABLE = { message: 'relation "public.olx_adverts" does not exist', code: '42P01' };
