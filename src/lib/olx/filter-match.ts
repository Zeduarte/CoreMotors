/**
 * Filtrar o stock pelos campos do OLX. À parte de `fields.ts` (que traz as
 * tabelas de correspondência dos campos) porque corre no browser, na pesquisa:
 * só isto vai para a página do stock.
 */

/** { código: valor | [valores] } — os códigos e valores são os do OLX. */
type OlxValues = Record<string, string | string[]>;

/** Filtro de um campo: um valor da lista, ou um intervalo para números. */
export type OlxFilter = string | { min: number | null; max: number | null };
export type OlxFilters = Record<string, OlxFilter>;

export function matchesOlxFilters(values: OlxValues | undefined, filters: OlxFilters): boolean {
  for (const [code, filter] of Object.entries(filters)) {
    const v = values?.[code];
    if (typeof filter === "string") {
      if (!filter) continue;
      if (v === undefined || !(Array.isArray(v) ? v.includes(filter) : v === filter)) return false;
    } else {
      if (filter.min == null && filter.max == null) continue;
      const n = Number(Array.isArray(v) ? v[0] : v);
      if (!Number.isFinite(n)) return false;
      if (filter.min != null && n < filter.min) return false;
      if (filter.max != null && n > filter.max) return false;
    }
  }
  return true;
}
