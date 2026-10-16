"use client";

import { useEffect } from "react";
import { useBrandIdentity } from "@/components/layout/BrandIdentity";
import { ErrorScreen } from "@/components/layout/ErrorScreen";
import { site } from "@/lib/site";

/**
 * «Algo correu mal»: um erro inesperado numa página. Fica dentro do layout
 * raiz (as cores da marca continuam), com a marca do stand, «Tentar novamente»
 * e o atalho para o stock.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const brand = useBrandIdentity();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorScreen
      companyName={brand?.companyName ?? site.name}
      logoUrl={brand?.logoUrl ?? null}
      eyebrow="Erro"
      title="Algo correu mal"
      text={`Não conseguimos mostrar esta página. Tente outra vez daqui a pouco — o stock continua disponível.${
        error.digest ? ` (Código ${error.digest})` : ""
      }`}
    >
      <button
        type="button"
        onClick={reset}
        className="rounded-full border border-white/15 px-8 py-3.5 text-sm font-semibold text-paper transition-colors hover:border-white/50"
      >
        Tentar novamente
      </button>
    </ErrorScreen>
  );
}
