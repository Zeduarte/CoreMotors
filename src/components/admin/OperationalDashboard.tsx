import { getAdminVehicleType } from "@/lib/vehicle-context";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
export async function OperationalDashboard() {
 const db=await createClient();const {data:allowed}=await db.rpc("has_section",{section:"leads"});
 if(!allowed)return null;
 const vehicleType=await getAdminVehicleType();
 const now=new Date(Date.now()+86400000).toISOString();
 const [{data:due,error},{count:unanswered},{count:unassigned}]=await Promise.all([
  db.from("leads").select("id,name,next_action,next_action_at").or(`vehicle_type.eq.${vehicleType},vehicle_type.is.null`).in("status",["new","contacted","proposal"]).lte("next_action_at",now).order("next_action_at").limit(10),
  db.from("leads").select("id",{count:"exact",head:true}).or(`vehicle_type.eq.${vehicleType},vehicle_type.is.null`).eq("status","new").is("first_contacted_at",null),
  db.from("leads").select("id",{count:"exact",head:true}).or(`vehicle_type.eq.${vehicleType},vehicle_type.is.null`).in("status",["new","contacted","proposal"]).is("assigned_to",null),
 ]);
 return <section className="mb-8 space-y-4"><h2 className="text-xl font-semibold">Ações em atraso e próximas 24 horas</h2><div className="grid gap-3 sm:grid-cols-2"><Link href="/admin/leads?due=unanswered" className="card p-4"><strong>{unanswered??0}</strong> contactos sem resposta</Link><Link href="/admin/leads?due=unassigned" className="card p-4"><strong>{unassigned??0}</strong> contactos por atribuir</Link></div>
 {error?<p role="alert">Não foi possível carregar as ações.</p>:due?.length?<div className="card divide-y divide-white/10">{due.map(l=><Link href={`/admin/leads/${l.id}`} className="block p-4 hover:bg-white/5" key={l.id}><strong>{l.name}</strong><p className="text-sm text-paper/60">{l.next_action} · {new Date(l.next_action_at!).toLocaleString("pt-PT",{timeZone:"Europe/Lisbon"})}</p></Link>)}</div>:<p className="text-sm text-paper/60">Sem ações previstas para este período.</p>}
 <Link href="/admin/leads?due=overdue" className="text-sm text-accent">Ver todas as ações em atraso →</Link></section>;
}
