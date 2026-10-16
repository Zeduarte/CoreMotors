"use client";

import { createContext, useContext } from "react";

/**
 * Nome e logótipo do stand para o que corre no browser sem acesso à BD — a
 * página «algo correu mal» (`error.tsx`) é um componente de cliente e não pode
 * chamar `getBranding()`. O layout raiz já os tem e passa-os por aqui.
 */
export interface BrandIdentity {
  companyName: string;
  logoUrl: string | null;
}

const Ctx = createContext<BrandIdentity | null>(null);

export function BrandIdentityProvider({
  value,
  children,
}: {
  value: BrandIdentity;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** `null` fora do provider (ex.: `global-error`, que substitui o layout raiz). */
export function useBrandIdentity(): BrandIdentity | null {
  return useContext(Ctx);
}
