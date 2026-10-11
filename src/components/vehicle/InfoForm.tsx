"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { PrivacyNotice } from "@/components/forms/PrivacyNotice";
import { submitLead, type LeadActionState } from "@/lib/actions/leads";

/**
 * Formulário "Pedir mais informações" sobre uma viatura. Persiste como lead
 * (kind = "contact"), associado à viatura.
 *
 * Curto de propósito: nome e telefone (ou email) chegam, e a mensagem já vem
 * escrita — quem só quer saber se a viatura está disponível envia em segundos.
 */
export function InfoForm({
  vehicleName,
  vehicleId,
  initialMessage,
}: {
  vehicleName: string;
  vehicleId?: string;
  /** Mensagem já escrita (ex.: uma pergunta rápida escolhida na ficha). */
  initialMessage?: string;
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
    const phone = data.phone?.trim() ?? "";
    const email = data.email?.trim() ?? "";
    if (!data.name?.trim()) next.name = "Indique o seu nome.";
    if (!phone && !email) next.phone = "Indique o telefone ou o email, para lhe respondermos.";
    else if (phone && !/^[\d\s+]{9,}$/.test(phone)) next.phone = "Telefone inválido.";
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) next.email = "Email inválido.";
    if (!data.message?.trim()) next.message = "Escreva a sua questão.";
    setErrors(next);
    if (Object.keys(next).length > 0) e.preventDefault();
  }

  if (state.ok) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-accent/30 bg-accent/10 p-6 text-center"
      >
        <p className="text-lg font-semibold text-paper">Pedido enviado</p>
        <p className="mt-1 text-sm text-paper/60">
          Vamos responder às suas questões o mais rápido possível.
        </p>
      </motion.div>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={validate}
      className="grid gap-4"
    >
      <input type="hidden" name="kind" value="contact" />
      {vehicleId && <input type="hidden" name="car_id" value={vehicleId} />}
      <input type="hidden" name="car_label" value={vehicleName} />

      <Field id="name" label="Nome" error={errors.name}>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          className="field"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="phone" label="Telefone" error={errors.phone}>
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            className="field"
          />
        </Field>
        <Field id="email" label="Email (opcional)" error={errors.email}>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            className="field"
          />
        </Field>
      </div>

      <Field id="message" label="Mensagem" error={errors.message}>
        <textarea
          id="message"
          name="message"
          rows={3}
          className="field"
          defaultValue={initialMessage ?? `Olá! Tenho interesse no ${vehicleName}. Ainda está disponível?`}
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
        className="mt-1 rounded-full bg-accent px-8 py-3.5 text-sm font-semibold text-ink transition-transform hover:scale-[1.02] disabled:opacity-60"
      >
        {pending ? "A enviar…" : "Enviar mensagem"}
      </button>
    </form>
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
