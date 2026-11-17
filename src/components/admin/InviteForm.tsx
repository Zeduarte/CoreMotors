"use client";

import { useActionState } from "react";
import { acceptInvite, type InviteFormState } from "@/lib/actions/invites";
import { submitKeepingFields } from "@/lib/form-submit";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/usernames";

/** Definir a palavra-passe a partir do link de convite. */
export function InviteForm({ token, username }: { token: string; username: string }) {
  const [state, formAction, pending] = useActionState<InviteFormState, FormData>(acceptInvite, {});

  return (
    <form onSubmit={submitKeepingFields(formAction)} className="card space-y-4 p-6">
      <input type="hidden" name="token" value={token} />
      <div>
        <h1 className="text-lg font-semibold text-paper">Definir palavra-passe</h1>
        <p className="mt-1 text-sm text-paper/60">
          Escolha a palavra-passe com que vai entrar no backoffice.
        </p>
      </div>

      <div>
        <label htmlFor="username" className="field-label">
          Nome de utilizador
        </label>
        {/* Para o gestor de palavras-passe do browser guardar o par certo. */}
        <input id="username" name="username" className="field" value={username} autoComplete="username" readOnly />
      </div>

      <div>
        <label htmlFor="password" className="field-label">
          Palavra-passe nova (mín. {PASSWORD_MIN} caracteres)
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          maxLength={PASSWORD_MAX}
          required
          autoFocus
          className="field"
        />
      </div>

      <div>
        <label htmlFor="confirm" className="field-label">
          Repetir a palavra-passe
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          maxLength={PASSWORD_MAX}
          required
          className="field"
        />
      </div>

      {state.error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "A guardar…" : "Guardar e entrar"}
      </button>
    </form>
  );
}
