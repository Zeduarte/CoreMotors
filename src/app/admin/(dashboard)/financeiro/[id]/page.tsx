import { getAllowedVehicleTypes } from "@/lib/vehicle-context";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSection } from "@/lib/guard";
import { createClient } from "@/lib/supabase/server";
import { ActionForm, Field } from "@/components/admin/ActionForm";
import { AuditHistory } from "@/components/admin/AuditHistory";
import { addVehicleCost,deleteVehicleCost,saveFinancials } from "@/lib/actions/operations";
import { COST_LABELS,margin,marginHint,daysInStock } from "@/lib/operations";
import { formatPrice } from "@/lib/format";
import { VehicleRateForm } from "@/components/admin/VehicleRateForm";
export const dynamic="force-dynamic";
export default async function FinanceVehicle({params}: {params:Promise<{id:string}>}) {
  await requireSection("financeiro"); const {id}=await params; const db=await createClient();const types=await getAllowedVehicleTypes();
  const [{data:car},{data:finance,error},{data:costs,error:costError},{data:tasks},{data:settings}]=await Promise.all([db.from("cars").select("id,make,model,price,status,license_plate").in("vehicle_type", types).eq("id",id).maybeSingle(),db.from("vehicle_financials").select("*").eq("car_id",id).maybeSingle(),db.from("vehicle_costs").select("*").eq("car_id",id).order("incurred_on",{ascending:false}),db.from("vehicle_tasks").select("hours").eq("car_id",id),db.from("site_settings").select("workshop_hourly_rate").eq("id",1).maybeSingle()]);
  if(!car) notFound(); if(error||costError) throw new Error("Não foi possível carregar os custos.");
  const manualCosts=(costs??[]).reduce((n,c)=>n+Number(c.amount),0);
  // Mão de obra da oficina = horas registadas × valor/hora (definido em Definições).
  const workshopHours=Math.round((tasks??[]).reduce((n,t)=>n+Number(t.hours||0),0)*100)/100;
  const defaultRate=Number(settings?.workshop_hourly_rate??0)||0;
  const overrideRate=finance?.hourly_rate_override==null?null:Number(finance.hourly_rate_override);
  const rate=overrideRate??defaultRate;
  const labourCost=Math.round(workshopHours*rate*100)/100;
  const total=manualCosts+labourCost;
  const purchase=finance?.purchase_price == null ? null : Number(finance.purchase_price);
  const sale=finance?.sale_price == null ? null : Number(finance.sale_price);
  const expected=margin(purchase,total,car.price);const actual=margin(purchase,total,sale);
  const date=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Lisbon"}).format(new Date());
  return <div className="space-y-6"><Link href="/admin/financeiro" className="text-accent">← Custos e margens</Link><h1 className="text-2xl font-bold">{car.make} {car.model} · {car.license_plate}</h1>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[["Custos totais",formatPrice(total)],["Mão de obra (oficina)",`${formatPrice(labourCost)} · ${workshopHours} h`],["Margem prevista",expected==null?marginHint(purchase,car.price):formatPrice(expected)],["Margem realizada",actual==null?(purchase===null?"Aquisição por preencher":"Venda por concluir"):formatPrice(actual)],["Dias em stock",String(daysInStock(finance?.acquired_on??null,finance?.sold_on??null)??"—")]].map(([l,v])=><div className="card p-4" key={l}><p className="text-sm text-paper/60">{l}</p><p className="mt-2 text-xl font-semibold">{v}</p></div>)}</div>
    <p className="text-sm text-paper/50">Margem operacional = preço de venda − aquisição − custos totais (custos lançados + mão de obra da oficina). {rate>0?`Mão de obra a ${formatPrice(rate)}/h${overrideRate!=null?" (valor específico desta viatura)":""}.`:"Defina o valor/hora no topo de Custos e margens para contabilizar a mão de obra."} Não inclui impostos.</p>
    <ActionForm action={saveFinancials}><h2 className="text-lg font-semibold">Aquisição</h2><input type="hidden" name="car_id" value={id}/><div className="grid gap-3 sm:grid-cols-2"><Field label="Data de aquisição"><input className="field" type="date" name="acquired_on" defaultValue={finance?.acquired_on??""}/></Field><Field label="Preço de aquisição (€)"><input className="field" type="number" step="0.01" min="0" name="purchase_price" defaultValue={purchase??""}/></Field></div></ActionForm>
    <VehicleRateForm carId={id} defaultRate={defaultRate} override={overrideRate}/>
    {sale!==null&&<p className="card p-4">Venda realizada: {formatPrice(sale)} · {finance?.sold_on}{car.price!==null&&` · Diferença para o preço anunciado atual: ${formatPrice(car.price-sale)}`}</p>}
    <ActionForm action={addVehicleCost} label="Adicionar custo"><h2 className="text-lg font-semibold">Novo custo</h2><input type="hidden" name="car_id" value={id}/><div className="grid gap-3 sm:grid-cols-2"><Field label="Categoria"><select name="category" className="field">{Object.entries(COST_LABELS).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></Field><Field label="Data"><input className="field" name="incurred_on" type="date" defaultValue={date} required/></Field><Field label="Descrição"><input className="field" name="description" maxLength={500} required/></Field><Field label="Valor (€)"><input className="field" name="amount" type="number" min="0.01" step="0.01" required/></Field></div></ActionForm>
    <section className="card p-5"><h2 className="mb-4 text-lg font-semibold">Custos registados</h2>{labourCost>0&&<div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 py-3"><div><p>Mão de obra · {formatPrice(labourCost)}</p><p className="text-sm text-paper/50">Oficina · {workshopHours} h × {formatPrice(rate)}/h · calculado automaticamente</p></div></div>}{!costs?.length&&labourCost===0&&<p className="text-paper/50">Sem custos adicionais.</p>}{costs?.map(c=><div key={c.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 py-3"><div><p>{c.description} · {formatPrice(Number(c.amount))}</p><p className="text-sm text-paper/50">{COST_LABELS[c.category]} · {c.incurred_on}</p></div><ActionForm action={deleteVehicleCost} label="Apagar" confirm="Apagar este custo? A alteração fica no histórico." className=""><input type="hidden" name="id" value={c.id}/></ActionForm></div>)}</section>
    <AuditHistory entity="vehicle_financials" id={id}/>
  </div>;
}
