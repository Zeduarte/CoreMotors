import { filterByVehicleType, getAdminTipo, getAdminVehicleTypes } from "@/lib/vehicle-context";
import { createClient } from "@/lib/supabase/server";
import { leadFilters,leadSearchOr } from "@/lib/lead-filters";
import { csvCell } from "@/lib/operations";
/** Data e hora de Lisboa, legível numa folha de cálculo (o servidor está em UTC). */
const lisbon=(iso:string|null)=>iso?new Date(iso).toLocaleString("pt-PT",{timeZone:"Europe/Lisbon",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}):"";
export async function GET(request:Request) {
 const db=await createClient();const {data:allowed}=await db.rpc("has_section",{section:"leads"});
 if(!allowed)return new Response("Sem permissão",{status:403});
 const params=new URL(request.url).searchParams;const general=params.get("gerais")==="1";const tipo=await getAdminTipo(params.get("tipo"));const types=await getAdminVehicleTypes(tipo);const includeNull=tipo!=="carros"&&tipo!=="motas";
 const f=leadFilters(Object.fromEntries(new URL(request.url).searchParams));
 // Pull one page per stream request. Memory stays bounded for large exports.
 // O responsável pelo nome, não pelo id.
 const {data:staff}=await db.rpc("staff_directory");const staffName=new Map((staff??[]).map(p=>[p.id,p.full_name]));
 let offset=0;let first=true;
 const stream=new ReadableStream({async pull(controller){
  try {
   if(first){controller.enqueue(new TextEncoder().encode("\uFEFF"+["Data do pedido","Nome","Email","Telefone","Tipo","Viatura","Estado","Responsável","Próxima ação","Quando","Motivo de perda"].map(csvCell).join(",")+"\r\n"));first=false;}
   let q=db.from("leads").select("*");
   q=filterByVehicleType(q,types,{includeNull,onlyNull:general});
   if(f.status)q=q.eq("status",f.status);
   if(f.q)q=q.or(leadSearchOr(f.q));
   if(f.assigned)q=q.eq("assigned_to",f.assigned);
   if(f.due==="overdue")q=q.in("status",["new","contacted","proposal"]).lt("next_action_at",new Date().toISOString());
   if(f.due==="unanswered")q=q.eq("status","new").is("first_contacted_at",null);
   if(f.due==="unassigned")q=q.is("assigned_to",null).in("status",["new","contacted","proposal"]);
   const {data,error}=await q.order("created_at",{ascending:false}).order("id").range(offset,offset+499);
   if(error)throw new Error("Exportação interrompida");
   const csv=(data??[]).map(l=>[lisbon(l.created_at),l.name,l.email,l.phone,l.vehicle_type==="motorcycle"?"Mota":l.vehicle_type==="car"?"Carro":"",l.car_label,l.status,l.assigned_to?staffName.get(l.assigned_to)??"":"",l.next_action,l.next_action_at,l.loss_reason].map(csvCell).join(",")).join("\r\n");
   if(csv)controller.enqueue(new TextEncoder().encode(csv+"\r\n"));
   offset+=500;if(!data||data.length<500)controller.close();
  }catch(e){controller.error(e);}
 }});
 return new Response(stream,{headers:{"Content-Type":"text/csv;charset=utf-8","Content-Disposition":"attachment; filename=contactos.csv","Cache-Control":"no-store"}});
}
