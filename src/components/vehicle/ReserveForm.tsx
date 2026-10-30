"use client";

import { isValidPhone } from "@/lib/phone";
import { useActionState, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PrivacyNotice } from "@/components/forms/PrivacyNotice";
import { submitLead, type LeadActionState } from "@/lib/actions/leads";
import { formatPrice } from "@/lib/format";

/**
 * Reserva de viatura com sinal.
 *
 * Cria uma lead do tipo `reservation` com o valor do sinal nos detalhes. O
 * pagamento em si (MB WAY/cartão via Stripe) é tratado depois pela equipa —
 * este passo garante a intenção de reserva e recolhe o contacto do cliente.
 */
export function ReserveForm({
  vehicleName,
  vehicleId,
  depositAmount,
  bare = false,
}: {
  vehicleName: string;
  vehicleId?: string;
  depositAmount: number;
  /** Quando true, não desenha o cartão/título próprios (usado no seletor). */
  bare?: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    LeadActionState,
    FormData
  >(submitLead, { ok: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  function validate(e: React.FormEvent<HTMLFormElement>) {
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<
      string,
      string
    >;
    const next: Record<string, string> = {};
    if (!data.name?.trim()) next.name = "Indique o seu nome.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email ?? ""))
      next.email = "Email inválido.";
    if (!isValidPhone(data.phone ?? ""))
      next.phone = "Telefone inválido.";
    setErrors(next);
    if (Object.keys(next).length > 0) e.preventDefault();
  }

  const content = (
    <>
      <p className="mb-2 text-sm text-paper/60">
        Peça a reserva do {vehicleName}. O sinal previsto é de{" "}
        <strong className="text-accent">{formatPrice(depositAmount)}</strong>. A
        viatura só fica reservada após confirmação pela equipa. Este pedido não
        cobra qualquer valor.
      </p>

      <AnimatePresence mode="wait">
        {state.ok ? (
          <motion.div
            key="success"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 rounded-2xl border border-accent/30 bg-accent/10 p-6 text-center"
          >
            <p className="text-lg font-semibold text-paper">
              Pedido de reserva recebido
            </p>
            <p className="mt-1 text-sm text-paper/60">
              Vamos contactá-lo para confirmar o pagamento do sinal e os
              próximos passos.
            </p>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            ref={formRef}
            action={formAction}
            onSubmit={validate}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-6 grid gap-4"
          >
            <input type="hidden" name="kind" value="reservation" />
            {vehicleId && (
              <input type="hidden" name="car_id" value={vehicleId} />
            )}
            <input type="hidden" name="car_label" value={vehicleName} />
            <input
              type="hidden"
              name="details"
              value={JSON.stringify({ deposit: depositAmount })}
            />

            <Field id="name" label="Nome" error={errors.name}>
              <input
                id="name"
                name="name" required minLength={2} maxLength={120}
                type="text"
                autoComplete="name"
                className="rinput"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="email" label="Email" error={errors.email}>
                <input
                  id="email"
                  name="email" required maxLength={254}
                  type="email"
                  autoComplete="email"
                  className="rinput"
                />
              </Field>
              <Field id="phone" label="Telefone" error={errors.phone}>
                <input
                  id="phone"
                  name="phone" required maxLength={40}
                  type="tel"
                  autoComplete="tel"
                  className="rinput"
                />
              </Field>
            </div>
            <Field id="message" label="Mensagem (opcional)">
              <textarea
                id="message"
                name="message"
                rows={2}
                className="rinput"
              />
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
              className="mt-2 rounded-full bg-accent px-8 py-3.5 text-sm font-semibold text-ink transition-transform duration-300 ease-premium hover:scale-[1.02] disabled:opacity-60"
            >
              {pending ? "A registar…" : "Pedir reserva"}
            </button>
          </motion.form>
        )}
      </AnimatePresence>

      <style>{`
        .rinput {
          width: 100%;
          border-radius: 0.75rem;
          border: 1px solid rgba(255,255,255,0.1);
          background: #0A0A0A;
          padding: 0.65rem 0.85rem;
          font-size: 0.875rem;
          color: #F5F5F4;
          transition: border-color 0.2s;
        }
        .rinput:focus { outline: none; border-color: var(--accent); }
      `}</style>
    </>
  );

  if (bare) return content;

  return (
    <section
      aria-labelledby="reserve-title"
      className="rounded-3xl border border-accent/40 bg-accent/5 p-6 md:p-8"
    >
      <span className="inline-block rounded-full bg-accent/20 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent">
        Pedir reserva
      </span>
      <h2 id="reserve-title" className="mt-3 text-2xl font-semibold text-paper">
        Peça a reserva desta viatura
      </h2>
      {content}
    </section>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-sm font-medium text-paper"
      >
        {label}
      </label>
      {children}
      {error && (
        <p className="mt-1 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
