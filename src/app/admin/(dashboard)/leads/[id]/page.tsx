import { getAdminVehicleType } from "@/lib/vehicle-context";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSection } from "@/lib/guard";
import { canAccess } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { ActionForm, Field } from "@/components/admin/ActionForm";
import { AuditHistory } from "@/components/admin/AuditHistory";
import { saveLeadNotesForm, saveLeadFollowup, addLeadActivity, reserveVehicle, releaseReservation, confirmDeposit, closeSale } from "@/lib/actions/operations";
import { LocalDateTime } from "@/components/admin/LocalDateTime";
import { formatPrice } from "@/lib/format";
import { confirmVisit, scheduleVisit, setVisitOutcome } from "@/lib/actions/visits";
import { markAlertMatchSent } from "@/lib/actions/alerts";
import { alertCarLabel, alertMessage, criteriaLabel, customerPhone } from "@/lib/stock-alerts";
import { parseCriteria } from "@/lib/stock-alert-schema";
import { visitContext } from "@/lib/visit-run";
import { visitMessage, visitWhenLabel } from "@/lib/visits";
import { site } from "@/lib/site";
export const dynamic = "force-dynamic";
export default async function LeadPage({params}: {params:Promise<{id:string}>}) {
  const me = await requireSection("leads");
  const {id} = await params;
  const db = await createClient();
  const vehicleType = await getAdminVehicleType();
  const [{data:lead,error},{data:staff},{data:activities},{data:reservations},{data:cars}] = await Promise.all([
    db.from("leads").select("*").eq("id",id).or(`vehicle_type.eq.${vehicleType},vehicle_type.is.null`).maybeSingle(), db.rpc("staff_directory"),
    db.from("lead_activities").select("*").eq("lead_id",id).order("created_at",{ascending:false}).limit(100),
    db.from("reservations").select("*").eq("lead_id",id).order("created_at",{ascending:false}),
    db.from("cars").select("id,make,model,license_plate,status").eq("vehicle_type",vehicleType).in("status",["published","reserved"]).order("make"),
  ]);
  if (error) throw new Error("Não foi possível carregar o contacto.");
  if (!lead) notFound();
  // Alerta de stock: as viaturas que entraram e correspondem (0042).
  const criteria = lead.kind === "alert" ? parseCriteria((lead.car_details ?? {}).criteria) : null;
  const {data: matches} = lead.kind === "alert"
    ? await db.from("stock_alert_matches").select("id, car_id, status, sent_at, error, created_at").eq("lead_id", id).order("created_at", {ascending: false}).limit(50)
    : {data: null};
  const {data: matchCars} = matches?.length
    ? await db.from("cars").select("id, slug, make, model, year, mileage, price, price_on_request, status").in("id", matches.map(m => m.car_id))
    : {data: null};
  const ctx = lead.kind === "alert" || lead.visit_at || lead.kind === "visit" ? await visitContext() : null;
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || site.url).replace(/\/$/, "");
  const phoneDigits = customerPhone(lead.phone);
  const optIn = Boolean((lead.car_details ?? {}).whatsapp_opt_in_at);
  const HIDDEN_DETAILS = new Set(["criteria", "whatsapp_opt_in_at", "visit_message_sent_at", "visit_message_error", "alert_cancelled_at"]);
  const details = Object.entries(lead.car_details ?? {}).filter(([key]) => !HIDDEN_DETAILS.has(key));
  const visitOpen = lead.visit_status === "requested" || lead.visit_status === "confirmed";
  const visitLabels: Record<string,string> = {requested:"Por confirmar",confirmed:"Confirmada",done:"Realizada",no_show:"Não compareceu",cancelled:"Cancelada"};
  const canCars = canAccess(me.role,me.allowed_sections,"carros");
  const canFinance = canAccess(me.role,me.allowed_sections,"financeiro");
  const inactive = ["won","lost","closed"].includes(lead.status);
  const date = new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Lisbon"}).format(new Date());
  const statusLabels = {new:"Novo",contacted:"Em contacto",proposal:"Proposta",lost:"Perdido",closed:"Fechado"};
  return <div className="space-y-6">
    <Link className="text-sm text-accent" href="/admin/leads">← Contactos</Link>
    <header><h1 className="text-2xl font-bold">{lead.name}</h1><p className="mt-2 text-paper/60">{lead.car_label ?? "Contacto geral"}</p>
      <div className="mt-3 flex flex-wrap gap-4 text-accent">{lead.email && <a href={`mailto:${lead.email}`}>{lead.email}</a>}{lead.phone && <a href={`tel:${lead.phone}`}>{lead.phone}</a>}</div>
      {lead.message && <p className="mt-4 whitespace-pre-wrap text-sm">{lead.message}</p>}
    </header>
    {lead.vehicle_type === null && <p className="card p-4 text-sm">Contacto antigo sem tipo. Associe um carro ou uma mota na área correspondente.</p>}
    {lead.next_action_at && !inactive && <div className="card border-accent/40 p-4"><strong>{new Date(lead.next_action_at)<new Date() ? "Ação em atraso" : "Próxima ação"}</strong><p>{lead.next_action} · {new Date(lead.next_action_at).toLocaleString("pt-PT",{timeZone:"Europe/Lisbon"})}</p></div>}
    {((lead.preferred_date && !lead.visit_at) || details.length > 0) && <section className="card space-y-2 p-4 text-sm">
      <h2 className="font-semibold">Detalhes do pedido</h2>
      {lead.preferred_date && !lead.visit_at && <p>Data preferida: {new Date(lead.preferred_date).toLocaleDateString("pt-PT")}</p>}
      {details.map(([key,value]) => <p key={key}>{key.replace(/_/g," ")}: {typeof value === "object" ? JSON.stringify(value) : String(value)}</p>)}
    </section>}
    {lead.kind === "alert" && <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Alerta de stock</h2>
        <span className="text-xs text-paper/50">{(lead.car_details ?? {}).alert_cancelled_at ? "Cancelado pelo cliente" : optIn && phoneDigits ? "Aviso automático por WhatsApp autorizado" : "Sem aviso automático — avise o cliente à mão"}</span>
      </div>
      <p className="text-sm">{criteria ? <>Procura: <strong>{criteriaLabel(criteria)}</strong></> : "Alerta antigo, só com texto: as viaturas novas não são comparadas automaticamente."}</p>
      {matches?.length ? <ul className="divide-y divide-white/10 rounded-xl border border-white/10">{matches.map(m => {
        const car = matchCars?.find(c => c.id === m.car_id);
        if (!car) return null;
        const url = `${baseUrl}/viaturas/${car.slug}`;
        const wa = phoneDigits ? `https://wa.me/${phoneDigits}?text=${encodeURIComponent(alertMessage({name: lead.name, company: ctx?.companyName ?? site.name, car: alertCarLabel(car), url}))}` : null;
        const label = ({pending:"Por avisar",sending:"A enviar",sent:"Avisado",manual:"Por avisar (à mão)",failed:"WhatsApp falhou",cancelled:"Já não está à venda"} as Record<string,string>)[m.status];
        return <li key={m.id} className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div><a href={url} target="_blank" rel="noopener noreferrer" className="font-medium text-paper hover:text-accent">{alertCarLabel(car)}</a>
            <p className="text-xs text-paper/50">{label}{m.sent_at ? ` · ${new Date(m.sent_at).toLocaleString("pt-PT",{timeZone:"Europe/Lisbon"})}` : ""}{m.error ? ` · ${m.error}` : ""}</p></div>
          {m.status !== "sent" && m.status !== "cancelled" && <div className="flex flex-wrap gap-2">
            {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="rounded-full border border-white/15 px-3 py-1.5 text-xs hover:border-emerald-400 hover:text-emerald-300">Enviar pelo WhatsApp</a>}
            <ActionForm action={markAlertMatchSent} label="Marcar como avisado" success="Registado." className="[&_button]:!px-3 [&_button]:!py-1.5 [&_button]:!text-xs"><input type="hidden" name="id" value={m.id}/><input type="hidden" name="lead_id" value={id}/></ActionForm>
          </div>}
        </li>;})}</ul> : <p className="text-sm text-paper/50">Ainda não entrou nenhuma viatura compatível. Quando entrar, aparece aqui{optIn && phoneDigits ? " e o cliente é avisado por WhatsApp" : ""}.</p>}
    </section>}
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Visita ao stand</h2>
        <Link href="/admin/leads/agenda" className="text-sm text-accent">Agenda →</Link>
      </div>
      {lead.visit_at ? <>
        <p className="text-sm"><strong>{visitWhenLabel(lead.visit_at)}</strong> · {visitLabels[lead.visit_status ?? "requested"]}{typeof (lead.car_details ?? {}).visit_message_sent_at === "string" ? " · confirmação enviada por WhatsApp" : ""}</p>
        {visitOpen && <div className="flex flex-wrap items-center gap-2">
          {lead.visit_status === "requested" && <ActionForm action={confirmVisit} label="Confirmar visita" success="Visita confirmada." className=""><input type="hidden" name="id" value={id}/></ActionForm>}
          {phoneDigits && ctx && <a href={`https://wa.me/${phoneDigits}?text=${encodeURIComponent(visitMessage({name: lead.name, company: ctx.companyName, at: lead.visit_at, car: lead.car_label, address: ctx.address}))}`} target="_blank" rel="noopener noreferrer" className="rounded-full border border-white/15 px-4 py-2 text-sm hover:border-emerald-400 hover:text-emerald-300">Enviar confirmação pelo WhatsApp</a>}
          {(["done","no_show","cancelled"] as const).map(st => <ActionForm key={st} action={setVisitOutcome} label={st === "done" ? "Realizada" : st === "no_show" ? "Não veio" : "Cancelar visita"} success="Registado." confirm={st === "cancelled" ? "Cancelar esta visita?" : undefined} className="[&_button]:!bg-transparent [&_button]:!border [&_button]:!border-white/15 [&_button]:!text-paper/75"><input type="hidden" name="id" value={id}/><input type="hidden" name="status" value={st}/></ActionForm>)}
        </div>}
      </> : <p className="text-sm text-paper/55">Sem visita marcada.</p>}
      {!inactive && <ActionForm action={scheduleVisit} label={lead.visit_at ? "Mudar a visita" : "Marcar visita"} success="Visita marcada." className="space-y-3">
        <input type="hidden" name="id" value={id}/>
        <Field label={lead.visit_at ? "Nova data e hora" : "Dia e hora"}><LocalDateTime name="at" required/></Field>
        <p className="text-xs text-paper/45">Fica confirmada. {optIn ? "O cliente recebe a confirmação por WhatsApp (se as mensagens aos clientes estiverem ligadas)." : "O cliente não autorizou WhatsApp automático: use o botão para lhe enviar a confirmação."}</p>
      </ActionForm>}
    </section>
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <ActionForm action={saveLeadFollowup} label="Guardar acompanhamento">
        <h2 className="text-lg font-semibold">Acompanhamento comercial</h2><input type="hidden" name="id" value={id}/>
        <Field label="Responsável"><select className="field" name="assigned_to" defaultValue={lead.assigned_to ?? ""}><option value="">Por atribuir</option>{staff?.filter(p=>p.role!=="mecanico").map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></Field>
        <Field label="Viatura"><select className="field" name="car_id" defaultValue={lead.car_id ?? ""}><option value="">Sem viatura associada</option>{lead.car_id && !cars?.some(c=>c.id===lead.car_id) && <option value={lead.car_id}>{lead.car_label ?? "Viatura associada"}</option>}{cars?.map(c=><option value={c.id} key={c.id}>{c.make} {c.model} · {c.license_plate}</option>)}</select></Field>
        <Field label="Estado"><select className="field" name="status" defaultValue={lead.status} disabled={lead.status === "won"}>{lead.status === "won" && <option value="won">Venda concluída</option>}{Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
        {lead.status === "won" && <input type="hidden" name="status" value="won"/>}
        {lead.status === "won" && <p className="text-sm text-paper/60">Venda concluída. O acompanhamento está encerrado.</p>}
        <Field label="Próxima ação"><input className="field" name="next_action" maxLength={500} defaultValue={lead.next_action ?? ""} placeholder="Ex.: Ligar para confirmar a visita"/></Field>
        <Field label="Quando"><LocalDateTime name="next_action_at" value={lead.next_action_at}/></Field>
        <Field label="Motivo de perda (obrigatório ao perder)"><textarea className="field" name="loss_reason" maxLength={1000} defaultValue={lead.loss_reason ?? ""}/></Field>
      </ActionForm>
      <div className="space-y-6">
        <ActionForm action={addLeadActivity} label="Registar atividade"><h2 className="text-lg font-semibold">Registar contacto</h2><input type="hidden" name="lead_id" value={id}/>
          <Field label="Tipo"><select name="kind" className="field">{Object.entries({call:"Chamada",message:"Mensagem",proposal:"Proposta",visit:"Visita / test drive",note:"Nota"}).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Resumo"><textarea name="body" className="field" required maxLength={4000} rows={3}/></Field>
        </ActionForm>
        <section className="card p-5"><h2 className="mb-3 text-lg font-semibold">Atividades recentes</h2><ol className="space-y-3">{activities?.map(a=><li key={a.id} className="border-b border-white/10 pb-3 text-sm"><p className="text-paper/50">{new Date(a.created_at).toLocaleString("pt-PT",{timeZone:"Europe/Lisbon"})} · {staff?.find(p=>p.id===a.created_by)?.full_name ?? "Equipa"}</p><p className="whitespace-pre-wrap">{a.body}</p></li>)}</ol>{!activities?.length && <p className="text-sm text-paper/50">Sem atividades registadas.</p>}</section>
      </div>
    </div>
    <section className="space-y-4"><h2 className="text-xl font-semibold">Reservas</h2>
      {reservations?.map(r=><div key={r.id} className="card space-y-3 p-4"><p>{({active:"Ativa",cancelled:"Cancelada",expired:"Expirada",completed:"Concluída"} as Record<string,string>)[r.status]} · Até {new Date(r.expires_at).toLocaleString("pt-PT",{timeZone:"Europe/Lisbon"})} · Sinal {formatPrice(Number(r.deposit_amount))} · {r.deposit_received ? "Recebido" : "Por receber"}</p>
        {r.status === "active" && <div className="flex flex-wrap gap-3">{!r.deposit_received && <ActionForm action={confirmDeposit} label="Confirmar sinal recebido" confirm="Confirmar que o sinal foi recebido?" className=""><input type="hidden" name="id" value={r.id}/></ActionForm>}{canCars && <ActionForm action={releaseReservation} label="Cancelar reserva" confirm="Cancelar a reserva e disponibilizar a viatura?" className=""><input type="hidden" name="id" value={r.id}/></ActionForm>}</div>}
      </div>)}
      {canCars && !inactive && <ActionForm action={reserveVehicle} label="Confirmar reserva" confirm="A viatura ficará reservada para este contacto."><input type="hidden" name="lead" value={id}/><div className="grid gap-3 sm:grid-cols-2"><Field label="Válida até"><LocalDateTime name="expiry" required/></Field><Field label="Sinal acordado (€)"><input className="field" type="number" name="deposit" min="0" step="0.01" required defaultValue="0"/></Field></div><p className="text-sm text-paper/50">Confirme o acordo com o cliente antes de reservar. O pagamento é registado pela equipa.</p></ActionForm>}
    </section>
    {canCars && canFinance && !inactive && <ActionForm action={closeSale} label="Concluir venda" confirm="Concluir a venda, marcar a viatura vendida e encerrar este contacto?"><h2 className="text-lg font-semibold">Concluir venda</h2><input type="hidden" name="lead" value={id}/><div className="grid gap-3 sm:grid-cols-2"><Field label="Preço efetivo de venda (€)"><input name="amount" className="field" type="number" step="0.01" min="0.01" required/></Field><Field label="Data da venda"><input name="sale_date" className="field" type="date" defaultValue={date} max={date} required/></Field></div></ActionForm>}
    <ActionForm action={saveLeadNotesForm} label="Guardar notas"><input type="hidden" name="id" value={id}/><Field label="Notas internas"><textarea name="notes" className="field" maxLength={5000} rows={3} defaultValue={lead.notes ?? ""}/></Field></ActionForm>
    <AuditHistory entity="leads" id={id}/>
  </div>;
}
