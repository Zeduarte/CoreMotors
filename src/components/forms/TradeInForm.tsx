"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PrivacyNotice } from "@/components/forms/PrivacyNotice";
import { submitLead, type LeadActionState } from "@/lib/actions/leads";

/**
 * Retoma (trade-in): o cliente descreve o carro atual e pede avaliação.
 * Cria uma lead `trade_in` com os detalhes do carro em `car_details`.
 */
export function TradeInForm() {
  const [state, formAction, pending] = useActionState<
    LeadActionState,
    FormData
  >(submitLead, { ok: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  // Empacota os detalhes do carro num JSON antes de enviar.
  function action(formData: FormData) {
    const data = Object.fromEntries(formData) as Record<string, string>;
    const next: Record<string, string> = {};
    if (!data.name?.trim()) next.name = "Indique o seu nome.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email ?? ""))
      next.email = "Email inválido.";
    if (!data.ti_make?.trim()) next.ti_make = "Indique a marca.";
    if (!data.ti_model?.trim()) next.ti_model = "Indique o modelo.";
    setErrors(next);
    if (Object.keys(next).length) return;

    formData.set(
      "details",
      JSON.stringify({
        marca: data.ti_make,
        modelo: data.ti_model,
        ano: data.ti_year,
        km: data.ti_km,
        estado: data.ti_condition,
      }),
    );
    formData.set(
      "car_label",
      `Retoma: ${data.ti_make} ${data.ti_model} ${data.ti_year ?? ""}`.trim(),
    );
    return formAction(formData);
  }

  return (
    <div className="card p-6 md:p-8">
      <h2 className="text-xl font-semibold text-paper">
        Avaliar a minha retoma
      </h2>
      <p className="mt-1 text-sm text-paper/50">
        Diga-nos o que tem e recebe uma estimativa + marcação de avaliação.
      </p>

      <AnimatePresence mode="wait">
        {state.ok ? (
          <motion.div
            key="ok"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 rounded-2xl border border-accent/30 bg-accent/10 p-6 text-center"
          >
            <p className="text-lg font-semibold text-paper">Pedido recebido</p>
            <p className="mt-1 text-sm text-paper/60">
              Vamos analisar e entrar em contacto com uma estimativa.
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
            <input type="hidden" name="kind" value="trade_in" />

            <p className="text-xs font-semibold uppercase tracking-wider text-paper/40">
              A sua viatura atual
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Marca" error={errors.ti_make}>
                <input name="ti_make" className="field" />
              </Field>
              <Field label="Modelo" error={errors.ti_model}>
                <input name="ti_model" className="field" />
              </Field>
              <Field label="Ano">
                <input name="ti_year" type="number" className="field" />
              </Field>
              <Field label="Quilómetros">
                <input name="ti_km" type="number" className="field" />
              </Field>
            </div>
            <Field label="Estado geral">
              <select name="ti_condition" className="field">
                <option value="Muito bom">Muito bom</option>
                <option value="Bom">Bom</option>
                <option value="Razoável">Razoável</option>
                <option value="Com danos">Com danos</option>
              </select>
            </Field>

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
            <Field label="Mensagem (opcional)">
              <textarea name="message" rows={2} className="field" />
            </Field>

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
              {pending ? "A enviar…" : "Pedir avaliação"}
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
