import Link from "next/link";
import { requireSection } from "@/lib/guard";
import { createClient } from "@/lib/supabase/server";
import { getAdminVehicleType } from "@/lib/vehicle-context";
import { ActionForm, Field } from "@/components/admin/ActionForm";
import { LocalDateTime } from "@/components/admin/LocalDateTime";
import { confirmVisit, createVisit, setVisitOutcome } from "@/lib/actions/visits";
import { getCustomerSettings, visitContext } from "@/lib/visit-run";
import { customerPhone } from "@/lib/stock-alerts";
import { VISIT_TZ, visitMessage, zonedParts } from "@/lib/visits";
import type { VisitStatus } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

const STATUS: Record<VisitStatus, { label: string; tone: string }> = {
  requested: { label: "Por confirmar", tone: "border-amber-400/40 bg-amber-400/10 text-amber-300" },
  confirmed: { label: "Confirmada", tone: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" },
  done: { label: "Realizada", tone: "border-white/15 bg-white/5 text-paper/60" },
  no_show: { label: "Não compareceu", tone: "border-rose-400/40 bg-rose-400/10 text-rose-300" },
  cancelled: { label: "Cancelada", tone: "border-white/10 bg-white/5 text-paper/40 line-through" },
};

const dayHeading = new Intl.DateTimeFormat("pt-PT", { timeZone: VISIT_TZ, weekday: "long", day: "numeric", month: "long" });
const timeOf = new Intl.DateTimeFormat("pt-PT", { timeZone: VISIT_TZ, hour: "2-digit", minute: "2-digit" });

/**
 * Agenda das visitas ao stand: as pedidas no site (por confirmar) e as
 * marcadas pela equipa, por dia. Confirmar envia a mensagem ao cliente por
 * WhatsApp, se ele a pediu e as mensagens aos clientes estiverem ligadas;
 * senão, o botão do WhatsApp abre a conversa com o texto já escrito.
 */
export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  await requireSection("leads");
  const { ver } = await searchParams;
  const past = ver === "anteriores";
  const db = await createClient();
  const vehicleType = await getAdminVehicleType();
  const now = new Date();
  const todayStart = new Date(`${zonedParts(now).date}T00:00:00Z`);
  todayStart.setUTCHours(todayStart.getUTCHours() - 2); // margem para o fuso de Lisboa

  let query = db
    .from("leads")
    .select("id, name, phone, car_label, car_details, visit_at, visit_status, kind, assigned_to")
    .not("visit_at", "is", null)
    .or(`vehicle_type.eq.${vehicleType},vehicle_type.is.null`);
  query = past
    ? query.lt("visit_at", now.toISOString()).gte("visit_at", new Date(now.getTime() - 60 * 86_400_000).toISOString()).order("visit_at", { ascending: false })
    : query.gte("visit_at", todayStart.toISOString()).order("visit_at", { ascending: true });
  const [{ data: visits, error }, { data: cars }, { data: staff }, settings, ctx] = await Promise.all([
    query.limit(300),
    db.from("cars").select("id, make, model, license_plate").eq("vehicle_type", vehicleType).in("status", ["published", "reserved"]).order("make"),
    db.rpc("staff_directory"),
    getCustomerSettings(db),
    visitContext(),
  ]);

  const rows = (visits ?? []).filter((v) => past || zonedParts(new Date(v.visit_at!)).date >= zonedParts(now).date);
  const groups = new Map<string, typeof rows>();
  for (const v of rows) {
    const key = zonedParts(new Date(v.visit_at!)).date;
    groups.set(key, [...(groups.get(key) ?? []), v]);
  }
  const pending = rows.filter((v) => v.visit_status === "requested").length;
  const today = zonedParts(now).date;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link className="text-sm text-accent" href="/admin/leads">
            ← Contactos
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-paper">Agenda de visitas</h1>
          <p className="mt-1 text-sm text-paper/50">
            Visitas ao stand pedidas no site e marcadas pela equipa.
            {pending > 0 && <strong className="ml-1 text-amber-300">{pending} por confirmar.</strong>}
          </p>
        </div>
        <nav className="flex gap-1 rounded-full border border-white/10 p-1 text-sm">
          <Link href="/admin/leads/agenda" className={`rounded-full px-4 py-1.5 ${!past ? "bg-white/10 text-paper" : "text-paper/60"}`}>
            Próximas
          </Link>
          <Link href="/admin/leads/agenda?ver=anteriores" className={`rounded-full px-4 py-1.5 ${past ? "bg-white/10 text-paper" : "text-paper/60"}`}>
            Anteriores
          </Link>
        </nav>
      </header>

      {settings.missing && (
        <p className="card border-amber-400/40 p-4 text-sm text-amber-200">
          Falta aplicar a migração 0042 na base de dados (Supabase → SQL). Até lá, a marcação de visitas fica desligada no site.
        </p>
      )}
      {!settings.missing && !settings.visitsEnabled && (
        <p className="card p-4 text-sm text-paper/70">
          A marcação de visitas no site está desligada. Ligue-a em <Link href="/admin/integracoes" className="text-accent">Integrações → Visitas e mensagens aos clientes</Link>.
        </p>
      )}
      {error && <p role="alert" className="card p-4 text-sm text-red-300">Não foi possível carregar a agenda.</p>}

      {!rows.length && !error && (
        <p className="card p-8 text-center text-sm text-paper/55">
          {past ? "Sem visitas nos últimos 60 dias." : "Sem visitas marcadas. Os pedidos feitos na ficha das viaturas aparecem aqui."}
        </p>
      )}

      {[...groups.entries()].map(([date, list]) => (
        <section key={date} className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-paper/50">
            {date === today ? "Hoje · " : ""}
            {dayHeading.format(new Date(list[0]!.visit_at!))}
          </h2>
          <ul className="card divide-y divide-white/10">
            {list.map((v) => {
              const st = STATUS[v.visit_status ?? "requested"];
              const phone = customerPhone(v.phone);
              const optIn = Boolean((v.car_details ?? {}).whatsapp_opt_in_at);
              const sentAt = (v.car_details ?? {}).visit_message_sent_at;
              const sendError = (v.car_details ?? {}).visit_message_error;
              const open = v.visit_status === "requested" || v.visit_status === "confirmed";
              const wa = phone
                ? `https://wa.me/${phone}?text=${encodeURIComponent(
                    visitMessage({ name: v.name, company: ctx.companyName, at: v.visit_at!, car: v.car_label, address: ctx.address }),
                  )}`
                : null;
              return (
                <li key={v.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-4">
                    <p className="w-14 shrink-0 text-lg font-semibold tabular-nums text-paper">{timeOf.format(new Date(v.visit_at!))}</p>
                    <div className="min-w-0">
                      <Link href={`/admin/leads/${v.id}`} className="font-semibold text-paper hover:text-accent">
                        {v.name}
                      </Link>
                      <p className="truncate text-sm text-paper/60">
                        {v.car_label ?? "Sem viatura associada"}
                        {v.phone && (
                          <>
                            {" · "}
                            <a href={`tel:${v.phone}`} className="text-accent">
                              {v.phone}
                            </a>
                          </>
                        )}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        <span className={`rounded-full border px-2 py-0.5 ${st.tone}`}>{st.label}</span>
                        {staff?.find((p) => p.id === v.assigned_to) && (
                          <span className="text-paper/45">{staff.find((p) => p.id === v.assigned_to)!.full_name}</span>
                        )}
                        {typeof sentAt === "string" && <span className="text-emerald-300/80">✓ Confirmação enviada por WhatsApp</span>}
                        {typeof sendError === "string" && sendError && (
                          <span className="text-rose-300/80" title={sendError}>
                            WhatsApp automático falhou
                          </span>
                        )}
                        {open && !optIn && <span className="text-paper/40">Sem autorização para WhatsApp automático</span>}
                      </p>
                    </div>
                  </div>
                  {open && (
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      {v.visit_status === "requested" && (
                        <ActionForm action={confirmVisit} label="Confirmar" success="Visita confirmada." className="[&_button]:!px-4 [&_button]:!py-2 [&_button]:!text-sm">
                          <input type="hidden" name="id" value={v.id} />
                        </ActionForm>
                      )}
                      {wa && (
                        <a
                          href={wa}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-full border border-white/15 px-4 py-2 text-sm text-paper/80 hover:border-emerald-400 hover:text-emerald-300"
                        >
                          WhatsApp
                        </a>
                      )}
                      {(["done", "no_show", "cancelled"] as const).map((s) => (
                        <ActionForm
                          key={s}
                          action={setVisitOutcome}
                          label={s === "done" ? "Realizada" : s === "no_show" ? "Não veio" : "Cancelar"}
                          success="Registado."
                          confirm={s === "cancelled" ? "Cancelar esta visita?" : undefined}
                          className="[&_button]:!bg-transparent [&_button]:!border [&_button]:!border-white/15 [&_button]:!px-3 [&_button]:!py-2 [&_button]:!text-sm [&_button]:!text-paper/70"
                        >
                          <input type="hidden" name="id" value={v.id} />
                          <input type="hidden" name="status" value={s} />
                        </ActionForm>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {!past && (
        <ActionForm action={createVisit} label="Marcar visita" success="Visita marcada.">
          <h2 className="text-lg font-semibold">Nova visita</h2>
          <p className="text-sm text-paper/55">Para quem liga ou escreve a combinar. Fica confirmada e entra nos contactos.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome do cliente">
              <input name="name" className="field" required maxLength={120} />
            </Field>
            <Field label="Telemóvel">
              <input name="phone" className="field" required inputMode="tel" />
            </Field>
            <Field label="Viatura">
              <select name="car_id" className="field" defaultValue="">
                <option value="">Sem viatura associada</option>
                {cars?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.make} {c.model}
                    {c.license_plate ? ` · ${c.license_plate}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Dia e hora">
              <LocalDateTime name="at" required />
            </Field>
          </div>
          <label className="flex items-start gap-2 text-sm text-paper/75">
            <input type="checkbox" name="whatsapp_opt_in" value="yes" className="mt-1" />
            O cliente aceitou receber a confirmação e o lembrete por WhatsApp.
          </label>
        </ActionForm>
      )}
    </div>
  );
}
