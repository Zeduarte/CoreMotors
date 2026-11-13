"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * O Callback URL a registar na aplicação do OLX Partner, pronto a copiar.
 *
 * Avisa também quando o backoffice está aberto noutro endereço: o regresso do
 * OLX só é aceite no navegador e no endereço onde a ligação começou (é lá que
 * fica o cookie do `state`).
 */
export function OlxCallbackUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [outroEndereco, setOutroEndereco] = useState<string | null>(null);

  useEffect(() => {
    try {
      const esperado = new URL(url).origin;
      if (window.location.origin !== esperado) setOutroEndereco(window.location.origin);
    } catch {
      // URL mal formado: mostra-se na mesma, sem o aviso.
    }
  }, [url]);

  function copy() {
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        toast.success("Callback URL copiado.");
        setTimeout(() => setCopied(false), 1500);
      },
      () => toast.error("Não foi possível copiar."),
    );
  }

  return (
    <div className="space-y-2 text-sm">
      <p className="text-paper/70">
        Callback URL a registar na aplicação do OLX Partner. Tem de ser exatamente este: com outro
        (ex.: <code>http://localhost</code>), o OLX devolve-o a esse endereço e a conta não fica ligada.
      </p>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 p-2.5">
        <code className="min-w-0 flex-1 break-all text-xs text-paper/80">{url}</code>
        <button
          type="button"
          onClick={copy}
          className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-paper/70 hover:border-accent hover:text-accent"
        >
          {copied ? "Copiado ✓" : "Copiar"}
        </button>
      </div>
      {outroEndereco && (
        <p className="text-xs text-amber-300">
          Está a usar o backoffice em {outroEndereco}. Para ligar a conta, abra-o em{" "}
          {new URL(url).origin}: o regresso do OLX só é aceite no endereço onde a ligação começou.
        </p>
      )}
    </div>
  );
}
