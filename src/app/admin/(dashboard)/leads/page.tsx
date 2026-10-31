import { getAdminVehicleType } from "@/lib/vehicle-context";
import Link from "next/link";
import { requireSection } from "@/lib/guard";
import { createClient } from "@/lib/supabase/server";
import { LEAD_STATUS_LABELS,leadFilters } from "@/lib/lead-filters";
import { LeadQuickCard,type QuickLead } from "@/components/admin/LeadQuickCard";
import { customerPhone } from "@/lib/stock-alerts";
import { visitWhenLabel } from "@/lib/visits";

const KIND_LABEL:Record<string,string>={contact:"Contacto",test_drive:"Test drive",finance:"Financiamento",trade_in:"Retoma",order:"Encomenda",reservation:"Reserva",offer:"Proposta",alert:"Alerta de stock",visit:"Visita ao stand"};
// Dados técnicos do pedido que não interessam a quem está a ler a lista.
const HIDDEN_DETAILS=new Set(["criteria","whatsapp_opt_in_at","visit_message_sent_at","visit_message_error","alert_cancelled_at","privacy_acknowledged_at","privacy_notice_version"]);

/** «agora», «há 5 min», «há 3 h», «há 2 dias». */
function ageLabel(iso:string,now:number):string{
 const min=Math.max(0,Math.round((now-new Date(iso).getTime())/60000));
 if(min<2)return "agora";if(min<60)return `há ${min} min`;
 const h=Math.round(min/60);if(h<24)return `há ${h} h`;
 const d=Math.round(h/24);return `há ${d} ${d===1?"dia":"dias"}`;
}
export const dynamic="force-dynamic";
export default async function LeadsPage({searchParams}: {searchParams:Promise<Record<string,string|undefined>>}) {
 const me=await requireSection("leads");const raw=await searchParams;const f=leadFilters(raw);const db=await createClient();
 const vehicleType=await getAdminVehicleType();const general=raw.gerais==="1";
 let query=db.from("leads").select("*",{count:"exact"});
 query=general?query.is("vehicle_type",null):query.eq("vehicle_type",vehicleType);
 if(f.status)query=query.eq("status",f.status);
 if(f.q)query=query.or(`name.ilike.%${f.q}%,email.ilike.%${f.q}%,phone.ilike.%${f.q}%,car_label.ilike.%${f.q}%`);
 if(f.assigned)query=query.eq("assigned_to",f.assigned);
 if(f.due==="overdue")query=query.in("status",["new","contacted","proposal"]).lt("next_action_at",new Date().toISOString());
 if(f.due==="unanswered")query=query.eq("status","new").is("first_contacted_at",null);
 if(f.due==="unassigned")query=query.is("assigned_to",null).in("status",["new","contacted","proposal"]);
 const [{data:leads,count,error},{data:staff}]=await Promise.all([query.order("created_at",{ascending:false}).order("id").range((f.page-1)*50,f.page*50-1),db.rpc("staff_directory")]);
 if(error)throw new Error("Não foi possível carregar os contactos.");
 const pages=Math.max(1,Math.ceil((count??0)/50));
 function href(page:number){const p=new URLSearchParams();for(const[k,v]of Object.entries(raw))if(v&&k!=="page")p.set(k,v);p.set("page",String(page));return `/admin/leads?${p}`;}
 const exportParams=new URLSearchParams();for(const[k,v]of Object.entries(raw))if(v&&k!=="page")exportParams.set(k,v);
 return <div className="space-y-6"><header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Contactos e acompanhamento</h1><p className="mt-1 text-sm text-paper/50">{count??0} contactos encontrados</p></div><a className="btn-ghost" href={`/api/admin/leads/export?${exportParams}`}>Exportar resultados CSV</a></header>
 <nav className="flex gap-4 text-sm text-accent"><Link href="/admin/leads">Contactos de {vehicleType === "car" ? "carros" : "motas"}</Link><Link href="/admin/leads?gerais=1">Contactos antigos sem tipo</Link></nav>{general && <p className="text-sm text-paper/60">Contactos anteriores sem tipo definido. Associe uma viatura para os classificar.</p>}
 <form className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">{general && <input type="hidden" name="gerais" value="1"/>}<label className="text-sm">Pesquisar<input className="field mt-1" name="q" defaultValue={f.q} placeholder="Nome, telefone, email ou viatura"/></label>
 <label className="text-sm">Estado<select className="field mt-1" name="status" defaultValue={f.status??""}><option value="">Todos</option>{Object.entries(LEAD_STATUS_LABELS).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label>
 <label className="text-sm">Responsável<select className="field mt-1" name="assigned" defaultValue={f.assigned??""}><option value="">Todos</option>{staff?.map(p=><option value={p.id} key={p.id}>{p.full_name}</option>)}</select></label>
 <label className="text-sm">Prioridade<select className="field mt-1" name="due" defaultValue={f.due??""}><option value="">Todas</option><option value="overdue">Ações em atraso</option><option value="unanswered">Sem resposta</option><option value="unassigned">Por atribuir</option></select></label><button className="btn-primary self-end">Filtrar</button></form>
 <ul className="space-y-3">{leads?.map(l=>{
  const now=Date.now();const open=["new","contacted","proposal"].includes(l.status);
  const details:{label:string;value:string}[]=[];
  if(l.preferred_date&&!l.visit_at)details.push({label:"Data pretendida",value:new Date(l.preferred_date).toLocaleDateString("pt-PT")});
  for(const[k,v]of Object.entries((l.car_details??{}) as Record<string,unknown>)){
   if(HIDDEN_DETAILS.has(k)||v==null||v===""||typeof v==="object")continue;
   details.push({label:k.replace(/_/g," ").replace(/^./,c=>c.toUpperCase()),value:String(v)});
  }
  const card:QuickLead={
   id:l.id,name:l.name,kind:l.kind,kindLabel:KIND_LABEL[l.kind]??l.kind,status:l.status,statusLabel:LEAD_STATUS_LABELS[l.status],
   phone:l.phone,whatsapp:customerPhone(l.phone),email:l.email,carLabel:l.car_label,message:l.message,details:details.slice(0,6),
   age:ageLabel(l.created_at,now),unanswered:l.status==="new"&&!l.first_contacted_at,
   assignedTo:l.assigned_to,assignedName:staff?.find(p=>p.id===l.assigned_to)?.full_name??null,
   nextAction:l.next_action,nextActionLabel:l.next_action_at?new Date(l.next_action_at).toLocaleString("pt-PT",{timeZone:"Europe/Lisbon",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):null,
   overdue:open&&!!l.next_action_at&&new Date(l.next_action_at).getTime()<now,
   visitLabel:l.visit_at?visitWhenLabel(l.visit_at):null,visitStatus:l.visit_at?l.visit_status:null,isNew:l.status==="new",
  };
  return <LeadQuickCard key={l.id} lead={card} staff={(staff??[]).filter(p=>p.role!=="mecanico").map(p=>({id:p.id,name:p.full_name}))} meId={me.id}/>;
 })}{!leads?.length&&<li className="card list-none p-8 text-paper/60">Nenhum contacto corresponde aos filtros.</li>}</ul>
 <nav aria-label="Paginação" className="flex items-center justify-between gap-3">{f.page>1?<Link className="btn-ghost" href={href(f.page-1)}>← Anterior</Link>:<span/>}<p className="text-sm">Página {f.page} de {pages}</p>{f.page<pages?<Link className="btn-ghost" href={href(f.page+1)}>Seguinte →</Link>:<span/>}</nav></div>;
}
