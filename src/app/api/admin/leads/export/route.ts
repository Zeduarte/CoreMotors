import { getAdminVehicleType } from "@/lib/vehicle-context";
import { createClient } from "@/lib/supabase/server";
import { leadFilters } from "@/lib/lead-filters";
import { csvCell } from "@/lib/operations";
export async function GET(request:Request) {
 const db=await createClient();const {data:allowed}=await db.rpc("has_section",{section:"leads"});
 if(!allowed)return new Response("Sem permissão",{status:403});
 const vehicleType=await getAdminVehicleType();const general=new URL(request.url).searchParams.get("gerais")==="1";
 const f=leadFilters(Object.fromEntries(new URL(request.url).searchParams));
 // Pull one page per stream request. Memory stays bounded for large exports.
 // O responsável pelo nome, não pelo id.
 const {data:staff}=await db.rpc("staff_directory");const staffName=new Map((staff??[]).map(p=>[p.id,p.full_name]));
 let offset=0;let first=true;
 const stream=new ReadableStream({async pull(controller){
  try {
   if(first){controller.enqueue(new TextEncoder().encode("\uFEFF"+["Nome","Email","Telefone","Viatura","Estado","Responsável","Próxima ação","Quando","Motivo de perda"].map(csvCell).join(",")+"\r\n"));first=false;}
   let q=db.from("leads").select("*");
   q=general?q.is("vehicle_type",null):q.eq("vehicle_type",vehicleType);
   if(f.status)q=q.eq("status",f.status);
   if(f.q)q=q.or(`name.ilike.%${f.q}%,email.ilike.%${f.q}%,phone.ilike.%${f.q}%,car_label.ilike.%${f.q}%`);
   if(f.assigned)q=q.eq("assigned_to",f.assigned);
   if(f.due==="overdue")q=q.in("status",["new","contacted","proposal"]).lt("next_action_at",new Date().toISOString());
   if(f.due==="unanswered")q=q.eq("status","new").is("first_contacted_at",null);
   if(f.due==="unassigned")q=q.is("assigned_to",null).in("status",["new","contacted","proposal"]);
   const {data,error}=await q.order("created_at",{ascending:false}).order("id").range(offset,offset+499);
   if(error)throw new Error("Exportação interrompida");
   const csv=(data??[]).map(l=>[l.name,l.email,l.phone,l.car_label,l.status,l.assigned_to?staffName.get(l.assigned_to)??"":"",l.next_action,l.next_action_at,l.loss_reason].map(csvCell).join(",")).join("\r\n");
   if(csv)controller.enqueue(new TextEncoder().encode(csv+"\r\n"));
   offset+=500;if(!data||data.length<500)controller.close();
  }catch(e){controller.error(e);}
 }});
 return new Response(stream,{headers:{"Content-Type":"text/csv;charset=utf-8","Content-Disposition":"attachment; filename=contactos.csv","Cache-Control":"no-store"}});
}
