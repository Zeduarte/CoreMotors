"use client";

import { useVehicleWorld } from "@/components/site/VehicleWorld";
import { useActionState, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PrivacyNotice } from "@/components/forms/PrivacyNotice";
import { submitLead, type LeadActionState } from "@/lib/actions/leads";

/**
 * Viatura por encomenda: o cliente descreve o carro que procura mesmo que não
 * esteja em stock. Cria uma lead `order` (procura qualificada).
 */
export function OrderCarForm() {
  const type = useVehicleWorld();
  const [state, formAction, pending] = useActionState<
    LeadActionState,
    FormData
  >(submitLead, { ok: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  function action(formData: FormData) {
    const data = Object.fromEntries(formData) as Record<string, string>;
    const next: Record<string, string> = {};
    if (!data.name?.trim()) next.name = "Indique o seu nome.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email ?? ""))
      next.email = "Email inválido.";
    if (!data.od_desc?.trim()) next.od_desc = "Descreva o que procura.";
    setErrors(next);
    if (Object.keys(next).length) return;

    formData.set(
      "details",
      JSON.stringify({
        procura: data.od_desc,
        orcamento: data.od_budget,
        combustivel: data.od_fuel,
      }),
    );
    formData.set("message", data.od_desc ?? "");
    formData.set("car_label", "Encomenda de viatura");
    return formAction(formData);
  }

  return (
    <div className="card p-6 md:p-8">
      <h2 className="text-xl font-semibold text-paper">
        Encomendar uma viatura
      </h2>
      <p className="mt-1 text-sm text-paper/50">
        Não encontrou o que procura? Diga-nos e nós procuramos por si.
      </p>

      <AnimatePresence mode="wait">
        {state.ok ? (
          <motion.div
            key="ok"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 rounded-2xl border border-accent/30 bg-accent/10 p-6 text-center"
          >
            <p className="text-lg font-semibold text-paper">Pedido registado</p>
            <p className="mt-1 text-sm text-paper/60">
              Assim que encontrarmos uma viatura à medida, avisamos.
            </p>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            ref={ref}
            action={action}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-6 grid gap-4"
          >
            <input type="hidden" name="kind" value="order" />

            <Field label="O que procura?" error={errors.od_desc}>
              <textarea
                name="od_desc"
                rows={3}
                className="field"
                placeholder={type === "motorcycle" ? "Ex.: Honda CB500, até 20.000 km" : "Ex.: BMW Série 3 diesel, automático, até 120.000 km, cor escura"}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Orçamento (€)">
                <input name="od_budget" type="number" className="field" />
              </Field>
              <Field label="Combustível preferido">
                <select name="od_fuel" className="field">
                  <option value="">Indiferente</option>
                  <option>Gasolina</option>
                  <option>Diesel</option>
                  <option>Híbrido</option>
                  <option>Elétrico</option>
                </select>
              </Field>
            </div>

            <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-paper/40">
              Contacto
            </p>
            <Field label="Nome" error={errors.name}>
              <input name="name" required minLength={2} maxLength={120} autoComplete="name" className="field" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email" error={errors.email}>
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  className="field"
                />
              </Field>
              <Field label="Telefone">
                <input
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  className="field"
                />
              </Field>
            </div>

            {state.error && (
              <p className="text-sm text-red-400" role="alert">
                {state.error}
              </p>
            )}
            <PrivacyNotice />
            <button
              type="submit"
              disabled={pending}
              className="btn-primary mt-1"
            >
              {pending ? "A enviar…" : "Enviar pedido"}
            </button>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="field-label">{label}</span>
      {children}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
