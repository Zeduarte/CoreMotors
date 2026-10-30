"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { submitActionForm, type ActionResult } from "@/lib/action-form";
export function ActionForm({ action, children, label = "Guardar", confirm, className = "card space-y-4 p-5", success = "Guardado.", danger = false }: {
  action: (data: FormData) => Promise<ActionResult>;
  children?: React.ReactNode; label?: string; confirm?: string; className?: string;
  /** O aviso quando corre bem — nem todas as ações guardam alguma coisa. */
  success?: string;
  /** Botão vermelho (ações que apagam). */
  danger?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const router = useRouter();
  // onSubmit e não `action`: ver submitActionForm (o React 19 limpava os campos
  // mesmo quando a gravação falhava ou a confirmação era cancelada).
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (confirm && !window.confirm(confirm)) return;
    start(async () => {
      setError("");
      await submitActionForm({
        data: () => {
          const data = new FormData(form);
          if (submitter instanceof HTMLButtonElement && submitter.name) data.append(submitter.name, submitter.value);
          return data;
        },
        confirm: () => true,
        action,
        onError: setError,
        reset: () => form.reset(),
        onSuccess: (result) => {
          toast.success(success);
          if (result.redirect) router.push(result.redirect);
          else router.refresh();
        },
      });
    });
  }
  return <form className={className} onSubmit={onSubmit}>
    <fieldset disabled={pending} className="space-y-3">{children}</fieldset>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <button className={danger ? "rounded-full border border-red-500/40 px-5 py-2.5 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-60" : "btn-primary"} disabled={pending}>{pending ? "A guardar…" : label}</button>
  </form>;
}
export function Field({label, children}: {label: string; children: React.ReactNode}) {
  return <label className="block text-sm"><span className="mb-1 block text-paper/70">{label}</span>{children}</label>;
}
