import { createClient } from "@/lib/supabase/server";
const labels: Record<string,string> = { price:"Preço anunciado", status:"Estado", assigned_to:"Responsável", next_action:"Próxima ação", next_action_at:"Data da ação", loss_reason:"Motivo de perda", license_plate:"Matrícula", purchase_price:"Preço de aquisição", sale_price:"Preço de venda", amount:"Valor", deposit_received:"Sinal recebido", expires_at:"Prazo", hours:"Horas", parts:"Peças", acquired_on:"Data de aquisição", sold_on:"Data de venda", rgpd:"Dados pessoais" };
export async function AuditHistory({entity,id}: {entity:string;id:string}) {
  const db = await createClient();
  const {data,error} = await db.from("audit_log").select("*").in("entity",entity === "vehicle_financials" ? [entity,"vehicle_costs"] : [entity]).eq("record_id",id).order("created_at",{ascending:false}).limit(30);
  return <section className="card p-5"><h2 className="mb-3 text-lg font-semibold">Histórico de alterações</h2>
    {error ? <p role="alert">Não foi possível carregar o histórico.</p> : !data?.length ? <p className="text-sm text-paper/50">Sem alterações registadas.</p> :
    <ol className="space-y-3">{data.map(e => <li key={e.id} className="border-b border-white/10 pb-3 text-sm">
      <p className="text-paper/50">{new Date(e.created_at).toLocaleString("pt-PT",{timeZone:"Europe/Lisbon"})} · {e.action === "INSERT" ? "Criado" : e.action === "DELETE" ? "Apagado" : e.action === "ERASE" ? "Dados pessoais apagados (RGPD)" : "Atualizado"} · {e.actor_id ? `Utilizador ${e.actor_id.slice(0,8)}` : "Sistema"}</p>
      {Object.entries(e.changed_fields).filter(([key]) => labels[key]).map(([key,v]) => <p key={key}>{labels[key]}: {String(v.before ?? "—")} → {String(v.after ?? "—")}</p>)}
    </li>)}</ol>}
  </section>;
}
