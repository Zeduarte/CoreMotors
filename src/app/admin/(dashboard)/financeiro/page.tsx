import { getAdminVehicleTypes, getAllowedVehicleTypes } from "@/lib/vehicle-context";
import { TypeFilter, TypeTag, typeChoice, withTipo } from "@/components/admin/TypeFilter";
import Link from "next/link";
import { requireSection } from "@/lib/guard";
import { createClient } from "@/lib/supabase/server";
import { allRows } from "@/lib/pagination";
import { daysInStock,margin } from "@/lib/operations";
import { formatPrice } from "@/lib/format";
import { WorkshopSettingsForm } from "@/components/admin/WorkshopSettingsForm";
export const dynamic="force-dynamic";
export default async function FinancePage({searchParams}: {searchParams:Promise<{q?:string;age?:string;tipo?:string}>}) {
 const me=await requireSection("financeiro");const db=await createClient();const params=await searchParams;const [types,allowedTypes]=await Promise.all([getAdminVehicleTypes(params.tipo),getAllowedVehicleTypes()]);const mixed=allowedTypes.length>1;
 const [cars,finances,costs,tasks]=await Promise.all([
  allRows((a,b)=>db.from("cars").select("id,make,model,license_plate,price,status,vehicle_type").in("vehicle_type", types).order("id").range(a,b)),
  allRows((a,b)=>db.from("vehicle_financials").select("*").order("car_id").range(a,b)),
  allRows((a,b)=>db.from("vehicle_costs").select("car_id,amount").order("id").range(a,b)),
  allRows((a,b)=>db.from("vehicle_tasks").select("car_id,hours").order("id").range(a,b)),
 ]);
 const {data:settings}=await db.from("site_settings").select("workshop_hourly_rate").eq("id",1).maybeSingle();
 const rate=Number(settings?.workshop_hourly_rate??0)||0;
 const rows=cars.map(c=>{const f=finances.find(f=>f.car_id===c.id);const manual=costs.filter(x=>x.car_id===c.id).reduce((n,x)=>n+Number(x.amount),0);const hours=tasks.filter(x=>x.car_id===c.id).reduce((n,x)=>n+Number(x.hours||0),0);const carRate=f?.hourly_rate_override==null?rate:Number(f.hourly_rate_override);const total=manual+Math.round(hours*carRate*100)/100;const purchase=f?.purchase_price==null?null:Number(f.purchase_price);return {...c,days:daysInStock(f?.acquired_on??null,f?.sold_on??null),purchase,cost:total,expected:margin(purchase,total,c.price),actual:margin(purchase,total,f?.sale_price==null?null:Number(f.sale_price))};});
 const filtered=rows.filter(c=>(!params.q||`${c.make} ${c.model} ${c.license_plate??""}`.toLowerCase().includes(params.q.toLowerCase()))&&(!params.age||(c.status!=="sold"&&(c.days??-1)>=Number(params.age))));
 return <div className="space-y-6"><h1 className="text-2xl font-bold">Custos e margens</h1><TypeFilter value={typeChoice(params.tipo)} allowed={allowedTypes} hrefFor={c=>withTipo("/admin/financeiro",params,c)}/>
 {me.role==="admin"&&<WorkshopSettingsForm initialRate={rate}/>}<div className="grid gap-3 sm:grid-cols-3">{[30,60,90].map(n=><Link className="card p-4" key={n} href={withTipo("/admin/financeiro",{tipo:params.tipo,age:String(n)},typeChoice(params.tipo))}><p className="text-sm text-paper/60">Stock há {n}+ dias</p><strong className="text-2xl">{rows.filter(c=>c.status!=="sold"&&(c.days??-1)>=n).length}</strong></Link>)}</div>
 <form className="flex flex-wrap gap-3"><input aria-label="Pesquisar viatura ou matrícula" className="field flex-1" name="q" defaultValue={params.q} placeholder="Pesquisar viatura ou matrícula"/><select aria-label="Dias em stock" className="field w-auto" name="age" defaultValue={params.age??""}><option value="">Todas as idades</option>{[30,60,90].map(n=><option value={n} key={n}>{n}+ dias em stock</option>)}</select>{params.tipo&&<input type="hidden" name="tipo" value={params.tipo}/>}<button className="btn-primary">Filtrar</button></form>
 <div className="card overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead><tr>{["Viatura","Dias em stock","Aquisição","Custos","Margem prevista","Margem realizada"].map(h=><th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{filtered.map(c=><tr key={c.id} className="border-t border-white/10"><td className="p-3"><Link href={`/admin/financeiro/${c.id}`} className="text-accent">{c.make} {c.model}{mixed&&<> <TypeTag type={c.vehicle_type}/></>}<span className="block text-paper/50">{c.license_plate}</span></Link></td><td className="p-3">{c.days??"—"}</td>{[c.purchase,c.cost,c.expected,c.actual].map((n,i)=><td className="p-3" key={i}>{n==null?"—":formatPrice(n)}</td>)}</tr>)}</tbody></table>{!filtered.length&&<p className="p-6 text-paper/50">Sem viaturas para estes filtros.</p>}</div><p className="text-sm text-paper/50">Valores em falta aparecem como “—”. As margens dependem dos custos registados.</p></div>;
}
