import type { LeadStatus } from "@/lib/supabase/database.types";
export const LEAD_STATUS_LABELS:Record<LeadStatus,string>={new:"Novos",contacted:"Em contacto",proposal:"Proposta",won:"Ganhos",lost:"Perdidos",closed:"Fechados"};
export function leadFilters(params:Record<string,string|undefined>) {
 const status=params.status&&params.status in LEAD_STATUS_LABELS?params.status as LeadStatus:undefined;
 const q=(params.q??"").replace(/[,%()\\]/g," ").trim().slice(0,100);
 const assigned=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.assigned??"")?params.assigned:undefined;
 const due=["overdue","unanswered","unassigned"].includes(params.due??"")?params.due:undefined;
 const page=Math.max(1,Math.min(100000,Math.floor(Number(params.page)||1)));
 return {status,q,assigned,due,page};
}
