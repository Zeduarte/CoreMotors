"use client";

import "./globals.css";
import { ErrorScreen } from "@/components/layout/ErrorScreen";
import { site } from "@/lib/site";

/**
 * O último recurso: o próprio layout raiz falhou (ex.: a BD não respondeu ao
 * carregar a marca). Substitui o `<html>` inteiro, por isso não há marca da BD
 * — fica o nome do stand das constantes e o atalho para o stock.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="pt-PT">
      <body className="min-h-dvh bg-ink font-sans antialiased">
        <ErrorScreen
          companyName={site.name}
          logoUrl={null}
          eyebrow="Erro"
          title="Algo correu mal"
          text="O site não está a responder como devia. Tente outra vez daqui a pouco."
        >
          <button
            type="button"
            onClick={reset}
            className="rounded-full border border-white/15 px-8 py-3.5 text-sm font-semibold text-paper transition-colors hover:border-white/50"
          >
            Tentar novamente
          </button>
        </ErrorScreen>
      </body>
    </html>
  );
}
