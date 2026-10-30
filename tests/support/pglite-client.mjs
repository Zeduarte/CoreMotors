// Um cliente Supabase mínimo sobre PGlite, para correr o código da app (ações,
// leituras) contra as migrações verdadeiras e o RLS, como um utilizador.
//
// Imita o PostgREST no que importa aqui: filtros, ordem, intervalos, upsert,
// `.select()` depois de escrever, RPC — e o corte em 1000 linhas por pedido
// (db-max-rows da Supabase), que é o que esconde totais errados.
import { asUserFactory } from './pglite.mjs';

export const MAX_ROWS = 1000;

const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error(`identificador inesperado: ${s}`);
  return `"${s}"`;
};

/** Divide "a, b, rel(c, d)" ao nível de topo. */
function splitTop(list) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Colunas do select, com relações embebidas de um nível (`car_media(*)`). */
function selectList(table, cols) {
  if (!cols || cols.trim() === '*') return 't.*';
  return splitTop(cols).map((c) => {
    const m = c.match(/^([a-z_]+)\((.*)\)$/i);
    if (!m) return c === '*' ? 't.*' : `t.${ident(c)}`;
    const [, rel, inner] = m;
    const fk = `${table.replace(/s$/, '')}_id`;
    const innerCols = inner.trim() === '*' ? 'r.*' : splitTop(inner).map((x) => `r.${ident(x)}`).join(',');
    return `(select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (select ${innerCols} from public.${ident(rel)} r where r.${ident(fk)} = t.id) x) as ${ident(rel)}`;
  }).join(', ');
}

export function createPgliteClient(db, userId) {
  const asUser = asUserFactory(db);
  let chain = Promise.resolve();
  // Um pedido de cada vez: a sessão (papel + utilizador) é global no PGlite.
  const run = (sql, params) => {
    const p = chain.then(() => asUser(userId, () => db.query(sql, params)));
    chain = p.catch(() => {});
    return p;
  };

  function from(table) {
    const where = []; const params = [];
    let mode = 'select'; let cols = '*'; let returning = null;
    let order = []; let range = null; let single = null; let payload = null; let onConflict = null;
    const param = (v) => { params.push(v); return `$${params.length}`; };
    const api = {
      select(c = '*') { if (mode === 'select') cols = c; else returning = c; return api; },
      eq(c, v) { where.push(`t.${ident(c)} = ${param(v)}`); return api; },
      neq(c, v) { where.push(`t.${ident(c)} <> ${param(v)}`); return api; },
      gte(c, v) { where.push(`t.${ident(c)} >= ${param(v)}`); return api; },
      lte(c, v) { where.push(`t.${ident(c)} <= ${param(v)}`); return api; },
      is(c, v) { where.push(`t.${ident(c)} is ${v === null ? 'null' : v ? 'true' : 'false'}`); return api; },
      in(c, vs) { where.push(vs.length ? `t.${ident(c)} in (${vs.map(param).join(',')})` : 'false'); return api; },
      order(c, o = {}) { order.push(`t.${ident(c)} ${o.ascending === false ? 'desc' : 'asc'}`); return api; },
      range(a, b) { range = [a, b]; return api; },
      limit(n) { range = [0, n - 1]; return api; },
      maybeSingle() { single = 'maybe'; return api; },
      single() { single = 'one'; return api; },
      delete() { mode = 'delete'; return api; },
      update(p) { mode = 'update'; payload = p; return api; },
      insert(rows) { mode = 'insert'; payload = [].concat(rows); return api; },
      upsert(rows, o = {}) { mode = 'upsert'; payload = [].concat(rows); onConflict = o.onConflict; return api; },
      then(resolve, reject) { return exec().then(resolve, reject); },
    };
    async function exec() {
      const w = where.length ? `where ${where.join(' and ')}` : '';
      let sql;
      if (mode === 'select') {
        const lim = range ? Math.min(range[1] - range[0] + 1, MAX_ROWS) : MAX_ROWS;
        const off = range ? range[0] : 0;
        sql = `select to_jsonb(q) j from (select ${selectList(table, cols)} from public.${ident(table)} t ${w} ${order.length ? `order by ${order.join(',')}` : ''} limit ${lim} offset ${off}) q`;
      } else {
        const ret = returning === null ? 't.*' : selectList(table, returning);
        let dml;
        if (mode === 'delete') dml = `delete from public.${ident(table)} t ${w} returning ${ret}`;
        if (mode === 'update') {
          const sets = Object.entries(payload).map(([k, v]) => `${ident(k)} = ${param(v)}`).join(', ');
          dml = `update public.${ident(table)} t set ${sets} ${w} returning ${ret}`;
        }
        if (mode === 'insert' || mode === 'upsert') {
          const keys = [...new Set(payload.flatMap(Object.keys))];
          const values = payload.map((r) => `(${keys.map((k) => (k in r ? param(r[k]) : 'default')).join(',')})`).join(',');
          const conflict = mode === 'upsert'
            ? ` on conflict (${onConflict.split(',').map((c) => ident(c.trim())).join(',')}) do update set ${keys.map((k) => `${ident(k)} = excluded.${ident(k)}`).join(', ')}`
            : '';
          dml = `insert into public.${ident(table)} as t (${keys.map(ident).join(',')}) values ${values}${conflict} returning ${ret}`;
        }
        sql = `with q as (${dml}) select to_jsonb(q) j from q`;
      }
      try {
        const rows = (await run(sql, params)).rows.map((r) => r.j);
        const data = mode !== 'select' && returning === null ? null : rows;
        if (single) {
          if (rows.length > 1 || (single === 'one' && rows.length !== 1)) {
            return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
          }
          return { data: rows[0] ?? null, error: null };
        }
        return { data, error: null };
      } catch (e) {
        return { data: null, error: { code: e.code, message: e.message } };
      }
    }
    return api;
  }

  async function rpc(name, args = {}) {
    const keys = Object.keys(args);
    const call = `public.${ident(name)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ')})`;
    try {
      const { rows: [info] } = await db.query('select bool_or(proretset) set from pg_proc where proname = $1', [name]);
      if (info?.set === null) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } };
      const sql = info.set ? `select to_jsonb(x) j from ${call} x` : `select to_jsonb(${call}) j`;
      const rows = (await run(sql, keys.map((k) => args[k]))).rows.map((r) => r.j);
      return { data: info.set ? rows.slice(0, MAX_ROWS) : rows[0], error: null };
    } catch (e) {
      return { data: null, error: { code: e.code, message: e.message } };
    }
  }

  return {
    from,
    rpc,
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }) },
  };
}
