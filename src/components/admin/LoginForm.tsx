"use client";

import { useActionState } from "react";
import { login, type AuthState } from "@/lib/actions/auth";
import { submitKeepingFields } from "@/lib/form-submit";

export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    login,
    {},
  );

  return (
    <form onSubmit={submitKeepingFields(formAction)} className="card space-y-4 p-6">
      <input type="hidden" name="redirect" value={redirectTo} />

      <div>
        <label htmlFor="username" className="field-label">
          Nome de utilizador
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          autoFocus
          className="field"
          placeholder="ex.: jose.duarte"
        />
      </div>

      <div>
        <label htmlFor="password" className="field-label">
          Palavra-passe
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="field"
          placeholder="••••••••"
        />
      </div>

      {state.error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "A entrar…" : "Entrar"}
      </button>
    </form>
  );
}
