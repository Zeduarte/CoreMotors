"use client";

import { openCookieSettings } from "@/lib/consent";

/**
 * «Gerir cookies»: reabre o banner de consentimento, para aceitar ou retirar
 * o consentimento dado antes (RGPD: retirar tem de ser tão fácil como dar).
 */
export function ManageCookiesButton({
  className,
  children = "Gerir cookies",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <button type="button" onClick={openCookieSettings} className={className}>
      {children}
    </button>
  );
}
