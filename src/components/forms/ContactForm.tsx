"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PrivacyNotice } from "@/components/forms/PrivacyNotice";
import { submitLead, type LeadActionState } from "@/lib/actions/leads";

/**
 * Formulário de contacto geral (site público). Persiste um `lead` (kind=contact)
 * no Supabase via Server Action, com validação Zod no servidor.
 */
export function ContactForm({
  subject = "",
  kind = "contact",
}: {
  subject?: string;
  kind?: "contact" | "finance";
}) {
  const [state, formAction, pending] = useActionState<
    LeadActionState,
    FormData
  >(submitLead, { ok: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  function validate(e: React.FormEvent<HTMLFormElement>) {
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<
      string,
      string
    >;
    const next: Record<string, string> = {};
    if (!data.name?.trim() || data.name.trim().length < 2)
      next.name = "Indique o seu nome.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email ?? ""))
      next.email = "Email inválido.";
    if (!data.message?.trim()) next.message = "Escreva a sua mensagem.";
    setErrors(next);
    if (Object.keys(next).length) e.preventDefault();
  }

  return (
    <div className="card p-6 md:p-8">
      <h2 className="text-xl font-semibold text-paper">
        Envie-nos uma mensagem
      </h2>
      <p className="mt-1 text-sm text-paper/50">
        Respondemos habitualmente no mesmo dia útil.
      </p>

      <AnimatePresence mode="wait">
        {state.ok ? (
          <motion.div
            key="ok"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 rounded-2xl border border-accent/30 bg-accent/10 p-6 text-center"
          >
            <p className="text-lg font-semibold text-paper">Mensagem enviada</p>
            <p className="mt-1 text-sm text-paper/60">
              Obrigado pelo contacto — responderemos em breve.
            </p>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            ref={ref}
            action={formAction}
            onSubmit={validate}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-6 grid gap-4"
          >
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="car_label" value={subject} />
            <div>
              <label htmlFor="c-name" className="field-label">
                Nome
              </label>
              <input
                id="c-name"
                name="name" required minLength={2} maxLength={120}
                className="field"
                autoComplete="name"
              />
              {errors.name && <p className="field-error">{errors.name}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="c-email" className="field-label">
                  Email
                </label>
                <input
                  id="c-email"
                  name="email"
                  type="email"
                  className="field"
                  autoComplete="email"
                />
                {errors.email && <p className="field-error">{errors.email}</p>}
              </div>
              <div>
                <label htmlFor="c-phone" className="field-label">
                  Telefone (opcional)
                </label>
                <input
                  id="c-phone"
                  name="phone"
                  type="tel"
                  className="field"
                  autoComplete="tel"
                />
              </div>
            </div>
            <div>
              <label htmlFor="c-msg" className="field-label">
                Mensagem
              </label>
              <textarea id="c-msg" name="message" rows={4} className="field" />
              {errors.message && (
                <p className="field-error">{errors.message}</p>
              )}
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
              {pending ? "A enviar…" : "Enviar mensagem"}
            </button>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
