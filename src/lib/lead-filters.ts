import type { LeadStatus } from "@/lib/supabase/database.types";
export const LEAD_STATUS_LABELS:Record<LeadStatus,string>={new:"Novos",contacted:"Em contacto",proposal:"Proposta",won:"Ganhos",lost:"Perdidos",closed:"Fechados"};
/**
 * O texto da pesquisa entra num filtro `or=(…)` do PostgREST: vírgulas,
 * parênteses, aspas e a barra mudariam a árvore do filtro (outra coluna, outro
 * operador), e `%`, `*` e `_` são curingas do `ilike`. Ficam espaços.
 */
export function leadSearchTerm(value:string|undefined):string {
 return (value??"").replace(/[,%()_\\*"]/g," ").replace(/\s+/g," ").trim().slice(0,100);
}
/** O filtro de pesquisa da lista e da exportação: nome, email, telefone ou viatura. */
export function leadSearchOr(q:string):string {
 const term=leadSearchTerm(q);
 return ["name","email","phone","car_label"].map(c=>`${c}.ilike.%${term}%`).join(",");
}
export function leadFilters(params:Record<string,string|undefined>) {
 const status=params.status&&params.status in LEAD_STATUS_LABELS?params.status as LeadStatus:undefined;
 const q=leadSearchTerm(params.q);
 const assigned=/^[0-9a-f-]{36}$/i.test(params.assigned??"")?params.assigned:undefined;
 const due=["overdue","unanswered","unassigned"].includes(params.due??"")?params.due:undefined;
 const page=Math.max(1,Math.min(100000,Math.floor(Number(params.page)||1)));
 return {status,q,assigned,due,page};
}
