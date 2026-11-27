"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveSocial } from "@/lib/actions/settings";
import { SOCIAL_LABEL, SOCIAL_NETWORKS, type SocialLinks } from "@/lib/social";

const PLACEHOLDER = { facebook: "https://www.facebook.com/ostand", instagram: "https://www.instagram.com/ostand ou @ostand" };

/** Definições → Contactos → Redes sociais: os links dos ícones do rodapé (vazio tira o ícone). */
export function SocialLinksForm({ initial }: { initial: SocialLinks }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const changed = SOCIAL_NETWORKS.some((n) => form[n] !== initial[n]);

  async function save() {
    setSaving(true);
    const res = await saveSocial(form);
    setSaving(false);
    if (res.ok) {
      toast.success("Redes sociais atualizadas.");
      router.refresh();
    } else {
      toast.error(res.error ?? "Não foi possível guardar.");
    }
  }

  return (
    <section className="card mt-6 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-paper/50">Redes sociais</h2>
      <p className="mb-4 mt-1 text-xs text-paper/50">
        Os ícones no rodapé do site, por baixo do logótipo. Deixe vazio para não mostrar o ícone.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {SOCIAL_NETWORKS.map((n) => (
          <label key={n} className="block">
            <span className="field-label">{SOCIAL_LABEL[n]}</span>
            <input
              className="field"
              type="text"
              inputMode="url"
              value={form[n]}
              onChange={(e) => setForm((f) => ({ ...f, [n]: e.target.value }))}
              placeholder={PLACEHOLDER[n]}
            />
          </label>
        ))}
      </div>
      <div className="mt-5 flex justify-end">
        <button type="button" onClick={save} disabled={saving || !changed} className="btn-primary">
          {saving ? "A guardar…" : "Guardar"}
        </button>
      </div>
    </section>
  );
}
