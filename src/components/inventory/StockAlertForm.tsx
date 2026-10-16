"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { PrivacyNotice } from "@/components/forms/PrivacyNotice";
import { submitLead, type LeadActionState } from "@/lib/actions/leads";
import { criteriaLabel, type AlertCriteria } from "@/lib/stock-alerts";
import { CAR_BRANDS } from "@/lib/car-brands";
import { MOTORCYCLE_BRANDS, bodiesFor, type VehicleType } from "@/lib/vehicle-categories";

export type AlertDefaults = Partial<{
  make: string | null;
  model: string | null;
  body: string | null;
  fuel: string | null;
  max_price: number | null;
  min_year: number | null;
  max_km: number | null;
}>;

type Draft = Record<"make" | "model" | "body" | "max_price" | "min_year" | "max_km", string>;

const toDraft = (d: AlertDefaults = {}): Draft => ({
  make: d.make ?? "",
  model: d.model ?? "",
  body: d.body ?? "",
  max_price: d.max_price ? String(d.max_price) : "",
  min_year: d.min_year ? String(d.min_year) : "",
  max_km: d.max_km ? String(d.max_km) : "",
});

/**
 * "Avise-me quando entrar" — o que a pessoa procura e como a avisamos.
 *
 * Os critérios (marca, modelo, preço máximo, …) ficam guardados no contacto:
 * quando uma viatura compatível é publicada, o cliente é avisado sozinho por
 * WhatsApp (se o pediu) e a equipa vê a correspondência no backoffice.
 *
 * No stock, os critérios acompanham a pesquisa (`defaults`) até a pessoa
 * mexer neles: quem filtrou "Yamaha até 8 000 €" e não encontrou nada tem o
 * alerta já preenchido.
 */
export function StockAlertForm({
  vehicleType,
  defaults,
  makes = [],
  title = "Avisamos quando entrar",
  eyebrow = "Não encontrou o que procura?",
}: {
  vehicleType: VehicleType;
  defaults?: AlertDefaults;
  /** Marcas em stock (vão primeiro nas sugestões). */
  makes?: string[];
  title?: string;
  eyebrow?: string;
}) {
  const [state, formAction, pending] = useActionState<LeadActionState, FormData>(submitLead, { ok: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Draft>(() => toDraft(defaults));
  const [dirty, setDirty] = useState(false);
  const [phone, setPhone] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  // Acompanha a pesquisa enquanto a pessoa não escrever nos critérios.
  const defaultsKey = JSON.stringify(defaults ?? {});
  useEffect(() => {
    if (!dirty) setDraft(toDraft(defaults));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultsKey]);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  const brandList = useMemo(
    () => [...new Set([...makes, ...(vehicleType === "motorcycle" ? MOTORCYCLE_BRANDS : CAR_BRANDS)])],
    [makes, vehicleType],
  );
  const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setDirty(true);
    setDraft((d) => ({ ...d, [key]: e.target.value }));
  };
  const num = (s: string) => (s.replace(/\D/g, "") ? Number(s.replace(/\D/g, "")) : null);
  const criteria: AlertCriteria = {
    vehicle_type: vehicleType,
    make: draft.make.trim() || null,
    model: draft.model.trim() || null,
    body: draft.body || null,
    fuel: defaults?.fuel ?? null,
    max_price: num(draft.max_price),
    min_year: num(draft.min_year),
    max_km: num(draft.max_km),
  };
  const hasCriteria = Boolean(criteria.make || criteria.body || criteria.max_price);

  function validate(e: React.FormEvent<HTMLFormElement>) {
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const next: Record<string, string> = {};
    const p = data.phone?.trim() ?? "";
    const email = data.email?.trim() ?? "";
    if (!hasCriteria) next.criteria = "Indique pelo menos a marca, a categoria ou o preço máximo.";
    if (!data.name?.trim()) next.name = "Indique o seu nome.";
    if (!p && !email) next.phone = "Indique o telemóvel ou o email, para o avisarmos.";
    else if (p && !/^[\d\s+]{9,}$/.test(p)) next.phone = "Telemóvel inválido.";
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) next.email = "Email inválido.";
    setErrors(next);
    if (Object.keys(next).length > 0) e.preventDefault();
  }

  if (state.ok) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl border border-accent/30 bg-accent/10 p-8 text-center"
      >
        <BellIcon className="mx-auto h-10 w-10 text-accent" />
        <p className="mt-3 text-lg font-semibold text-paper">Alerta criado!</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-paper/60">
          {phone
            ? "Assim que entrar uma viatura compatível, enviamos-lhe o link por WhatsApp."
            : "Assim que entrar uma viatura compatível, entramos em contacto."}
        </p>
      </motion.div>
    );
  }

  const field =
    "w-full rounded-xl border border-white/15 bg-ink px-4 py-3 text-sm text-paper placeholder:text-paper/40 focus:border-accent focus:outline-none";
  const label = "mb-1.5 block text-xs font-medium uppercase tracking-wider text-paper/45";

  return (
    <div className="rounded-3xl border border-white/10 bg-ink-soft p-6 md:p-10">
      <div className="flex items-start gap-4">
        <span className="hidden h-12 w-12 shrink-0 place-items-center rounded-2xl bg-accent/15 text-accent sm:grid">
          <BellIcon className="h-6 w-6" />
        </span>
        <div>
          <p className="eyebrow mb-2">{eyebrow}</p>
          <h2 className="text-2xl font-semibold text-paper md:text-3xl">{title}</h2>
          <p className="mt-2 max-w-xl text-sm text-paper/60">
            Diga-nos o que procura. Quando entrar uma viatura compatível, recebe o link no WhatsApp — é dos primeiros
            a saber, sem compromisso.
          </p>
        </div>
      </div>

      <form ref={formRef} action={formAction} onSubmit={validate} className="mt-7 grid gap-6">
        <input type="hidden" name="kind" value="alert" />
        <input type="hidden" name="vehicle_type" value={vehicleType} />
        {criteria.fuel && <input type="hidden" name="alert_fuel" value={criteria.fuel} />}

        <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <legend className="sr-only">O que procura</legend>
          <label>
            <span className={label}>Marca</span>
            <input
              name="alert_make"
              list="alert-brands"
              value={draft.make}
              onChange={set("make")}
              placeholder={vehicleType === "motorcycle" ? "Ex.: Yamaha" : "Ex.: BMW"}
              autoComplete="off"
              className={field}
            />
            <datalist id="alert-brands">
              {brandList.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </label>
          <label>
            <span className={label}>Modelo (opcional)</span>
            <input
              name="alert_model"
              value={draft.model}
              onChange={set("model")}
              placeholder={vehicleType === "motorcycle" ? "Ex.: MT-07" : "Ex.: Série 3"}
              className={field}
            />
          </label>
          <label>
            <span className={label}>{vehicleType === "motorcycle" ? "Categoria" : "Carroçaria"}</span>
            <select name="alert_body" value={draft.body} onChange={set("body")} className={field}>
              <option value="">Qualquer</option>
              {bodiesFor(vehicleType).map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={label}>Preço até (€)</span>
            <input
              name="alert_max_price"
              inputMode="numeric"
              value={draft.max_price}
              onChange={set("max_price")}
              placeholder="Sem limite"
              className={field}
            />
          </label>
          <label>
            <span className={label}>Ano desde</span>
            <input
              name="alert_min_year"
              inputMode="numeric"
              value={draft.min_year}
              onChange={set("min_year")}
              placeholder="Qualquer"
              className={field}
            />
          </label>
          <label>
            <span className={label}>Quilómetros até</span>
            <input
              name="alert_max_km"
              inputMode="numeric"
              value={draft.max_km}
              onChange={set("max_km")}
              placeholder="Sem limite"
              className={field}
            />
          </label>
        </fieldset>

        <p
          className={`flex flex-wrap items-center gap-2 text-sm ${hasCriteria ? "text-paper/75" : "text-paper/40"}`}
          aria-live="polite"
        >
          <BellIcon className="h-4 w-4 text-accent" />
          {hasCriteria ? (
            <>
              Avisamos quando entrar: <strong className="font-semibold text-paper">{criteriaLabel(criteria)}</strong>
            </>
          ) : (
            "Escolha pelo menos a marca, a categoria ou o preço."
          )}
        </p>
        {errors.criteria && <p className="-mt-4 text-xs text-rose-400">{errors.criteria}</p>}

        <div className="grid gap-4 border-t border-white/10 pt-6 sm:grid-cols-3">
          <label>
            <span className={label}>Nome</span>
            <input name="name" placeholder="O seu nome" autoComplete="name" className={field} />
            {errors.name && <p className="mt-1 text-xs text-rose-400">{errors.name}</p>}
          </label>
          <label>
            <span className={label}>Telemóvel (WhatsApp)</span>
            <input
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="912 345 678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={field}
            />
            {errors.phone && <p className="mt-1 text-xs text-rose-400">{errors.phone}</p>}
          </label>
          <label>
            <span className={label}>Email (opcional)</span>
            <input name="email" type="email" autoComplete="email" placeholder="nome@email.pt" className={field} />
            {errors.email && <p className="mt-1 text-xs text-rose-400">{errors.email}</p>}
          </label>
        </div>

        <label className="-mb-3 flex items-start gap-3 text-sm text-paper/80">
          <input
            type="checkbox"
            name="whatsapp_opt_in"
            value="yes"
            defaultChecked
            className="mt-0.5 shrink-0 accent-[color:var(--accent)]"
          />
          <span>
            Quero receber o aviso por WhatsApp, no telemóvel indicado.
            <span className="block text-xs text-paper/50">Pode cancelar o alerta a qualquer momento, no link da mensagem.</span>
          </span>
        </label>

        {state.error && <p className="text-sm text-rose-400">{state.error}</p>}

        <PrivacyNotice />
        <button
          type="submit"
          disabled={pending}
          className="-mt-3 inline-flex items-center justify-center gap-2 rounded-full bg-accent px-7 py-3.5 text-sm font-semibold text-ink transition-transform hover:scale-[1.02] disabled:opacity-60 sm:justify-self-start"
        >
          <BellIcon className="h-4 w-4" />
          {pending ? "A criar alerta…" : "Criar alerta"}
        </button>
      </form>
    </div>
  );
}

function BellIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
