"use client";

import { useState } from "react";
import { toast } from "sonner";
import { syncWhatsAppProfile } from "@/lib/actions/whatsapp";

/**
 * «Aplicar a marca»: manda à Meta o nome «Core Motors» e o logótipo do site para
 * o perfil do número — o que qualquer pessoa vê ao falar com a empresa.
 */
export function WhatsAppBrand({ disabled }: { disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string[]>([]);

  async function apply() {
    setBusy(true);
    try {
      const r = await syncWhatsAppProfile();
      setDone(r.done);
      if (r.ok) toast.success("Perfil do WhatsApp atualizado.");
      else toast.error(r.error ?? "Não foi possível atualizar o perfil.");
    } catch {
      toast.error("Não foi possível atualizar o perfil.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button type="button" className="btn-ghost" disabled={disabled || busy} onClick={apply}>
        {busy ? "A enviar…" : "Aplicar nome e logótipo (Core Motors)"}
      </button>
      {done.map((line) => (
        <p key={line} className="text-xs text-emerald-300">
          {line}
        </p>
      ))}
      <p className="text-xs text-paper/50">
        O nome passa por uma revisão da Meta (horas ou dias). O logótipo é o das Definições → Marca e tem
        de ser JPEG ou PNG.
      </p>
    </div>
  );
}
