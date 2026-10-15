"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
export function ActionForm({ action, children, label = "Guardar", confirm, className = "card space-y-4 p-5", success = "Guardado." }: {
  action: (data: FormData) => Promise<{ok: boolean; error?: string}>;
  children?: React.ReactNode; label?: string; confirm?: string; className?: string;
  /** O aviso quando corre bem — nem todas as ações guardam alguma coisa. */
  success?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const router = useRouter();
  return <form className={className} action={data => {
    if (confirm && !window.confirm(confirm)) return;
    start(async () => {
      setError("");
      try {
        const result = await action(data);
        if (!result.ok) setError(result.error ?? "Não foi possível guardar.");
        else { toast.success(success); router.refresh(); }
      } catch { setError("Não foi possível guardar. Verifique a ligação e tente novamente."); }
    });
  }}>
    <fieldset disabled={pending} className="space-y-3">{children}</fieldset>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <button className="btn-primary" disabled={pending}>{pending ? "A guardar…" : label}</button>
  </form>;
}
export function Field({label, children}: {label: string; children: React.ReactNode}) {
  return <label className="block text-sm"><span className="mb-1 block text-paper/70">{label}</span>{children}</label>;
}
