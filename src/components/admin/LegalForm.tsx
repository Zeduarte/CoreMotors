"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveLegal } from "@/lib/actions/settings";

interface LegalInitial {
  legal_name: string;
  nif: string;
  credit_intermediary_url: string;
  /** A base de dados ainda não tem os campos (falta a 0057). */
  missing: boolean;
}

/**
 * Identificação legal do stand: aparece no rodapé («Nome legal | NIF») e nas
 * políticas; a ficha de intermediário de crédito aparece na página de
 * Financiamento. Cada stand tem a sua (antes estava fixa no código).
 */
export function LegalForm({ initial }: { initial: LegalInitial }) {
  const router = useRouter();
  const [form, setForm] = useState({
    legal_name: initial.legal_name,
    nif: initial.nif,
    credit_intermediary_url: initial.credit_intermediary_url,
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setSaving(true);
    const res = await saveLegal(form);
    setSaving(false);
    if (res.ok) {
      toast.success("Identificação legal guardada.");
      router.refresh();
    } else {
      toast.error(res.error ?? "Não foi possível guardar.");
    }
  }

  return (
    <section className="card p-5">
      {initial.missing && (
        <p className="mb-4 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">
          A base de dados ainda não tem estes campos: aplique a migração <code>0057_projeto_proprio.sql</code> no
          Supabase → SQL Editor.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">Nome legal da empresa</span>
          <input className="field" value={form.legal_name} onChange={set("legal_name")} placeholder="Ex.: Fulano – Stand Automóvel, Unipessoal Lda" maxLength={160} />
          <p className="mt-1 text-xs text-paper/40">Vazio: usa o nome do stand.</p>
        </label>
        <label className="block">
          <span className="field-label">NIF</span>
          <input className="field" value={form.nif} onChange={set("nif")} placeholder="9 dígitos" inputMode="numeric" maxLength={11} />
        </label>
        <label className="block sm:col-span-2">
          <span className="field-label">Ficha de intermediário de crédito (PDF)</span>
          <input
            className="field"
            value={form.credit_intermediary_url}
            onChange={set("credit_intermediary_url")}
            placeholder="https://… (o PDF do Banco de Portugal)"
            maxLength={500}
          />
          <p className="mt-1 text-xs text-paper/40">
            Obrigatória para quem é intermediário de crédito: aparece na página de Financiamento. Vazio: não aparece.
          </p>
        </label>
      </div>
      <div className="mt-5 flex justify-end">
        <button type="button" onClick={save} disabled={saving || initial.missing} className="btn-primary">
          {saving ? "A guardar…" : "Guardar"}
        </button>
      </div>
    </section>
  );
}
