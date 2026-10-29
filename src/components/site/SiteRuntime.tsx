"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { isAdminCache, isAdminServiceWorker } from "@/lib/admin-pwa";
import { CONSENT_KEY, OPEN_CONSENT_EVENT, clearTrackingCookies } from "@/lib/consent";

/**
 * Runtime do site público (cliente):
 *   1. Desregista Service Workers antigos (excepto o do backoffice).
 *   2. Gere o consentimento de cookies (RGPD).
 *   3. Só carrega Google Analytics / Meta Pixel DEPOIS de o visitante aceitar.
 *
 * Sem consentimento explícito, nenhum script de rastreio é carregado. O
 * visitante pode mudar de ideias em «Gerir cookies» (rodapé e Política de
 * Cookies): retirar o consentimento corta os envios nesta página, apaga os
 * cookies de análise e, nas visitas seguintes, os scripts já não carregam.
 */

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean };
    _fbq?: unknown;
    [gaDisable: `ga-disable-${string}`]: boolean | undefined;
  }
}

/** Corta o GA4 e o Pixel já carregados nesta página e apaga os seus cookies. */
function revokeTracking(ga4Id: string | null) {
  if (ga4Id) window[`ga-disable-${ga4Id}`] = true;
  window.gtag?.("consent", "update", { analytics_storage: "denied", ad_storage: "denied" });
  window.fbq?.("consent", "revoke");
  try {
    clearTrackingCookies();
  } catch {
    /* ignora */
  }
}

function loadGA4(id: string) {
  if (document.getElementById("ga4-src")) return;
  const s = document.createElement("script");
  s.id = "ga4-src";
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer!.push(args);
  };
  window.gtag("js", new Date());
  window.gtag("config", id);
}

function loadPixel(id: string) {
  if (window.fbq) return;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const n: any = (window.fbq = function (...args: unknown[]) {
    if (n.callMethod) {
      n.callMethod(...args);
    } else {
      n.queue.push(args);
    }
  });
  if (!window._fbq) window._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = "2.0";
  n.queue = [];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(s);
  window.fbq!("init", id);
  window.fbq!("track", "PageView");
}

export function SiteRuntime({
  ga4Id,
  pixelId,
}: {
  ga4Id: string | null;
  pixelId: string | null;
}) {
  const pathname = usePathname();
  const [decision, setDecision] = useState<string | null>("pending");

  // Service Worker REMOVIDO: causava "Server Action not found" ao servir chunks
  // antigos em cache. Já não o registamos; e desregistamos qualquer SW que ainda
  // exista + limpamos as caches, para os browsers ficarem limpos sozinhos.
  // Excepção: o SW do backoffice (âmbito `/admin`, só rede — ver
  // src/lib/admin-sw.ts) e as suas caches; sem isto, cada visita ao site
  // desinstalava a app do backoffice.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) =>
        regs
          .filter((r) => !isAdminServiceWorker(r.scope))
          .forEach((r) => r.unregister()),
      )
      .catch(() => {});
    if ("caches" in window) {
      caches
        .keys()
        .then((keys) =>
          keys.filter((k) => !isAdminCache(k)).forEach((k) => caches.delete(k)),
        )
        .catch(() => {});
    }
  }, []);

  // Lê a decisão guardada.
  useEffect(() => {
    try {
      setDecision(localStorage.getItem(CONSENT_KEY));
    } catch {
      setDecision(null);
    }
  }, []);

  // «Gerir cookies» reabre o banner.
  useEffect(() => {
    const reopen = () => setDecision(null);
    window.addEventListener(OPEN_CONSENT_EVENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, reopen);
  }, []);

  // Carrega os scripts quando há consentimento.
  useEffect(() => {
    if (decision !== "yes") return;
    // Voltar a aceitar depois de retirar (na mesma página) reativa os envios.
    if (ga4Id) {
      window[`ga-disable-${ga4Id}`] = false;
      loadGA4(ga4Id);
      window.gtag?.("consent", "update", { analytics_storage: "granted", ad_storage: "granted" });
    }
    if (pixelId) {
      loadPixel(pixelId);
      window.fbq?.("consent", "grant");
    }
  }, [decision, ga4Id, pixelId]);

  function decide(value: "yes" | "no") {
    try {
      localStorage.setItem(CONSENT_KEY, value);
    } catch {
      /* ignora */
    }
    if (value === "no") revokeTracking(ga4Id);
    setDecision(value);
  }

  // O backoffice é para quem cá trabalha, com sessão iniciada: pedir-lhe
  // consentimento de cookies a cada visita é ruído, e o banner tapava o
  // conteúdo das páginas.
  if (pathname.startsWith("/admin")) return null;

  // Mostra o banner a qualquer visitante que ainda não decidiu. Os scripts de
  // rastreio (GA4/Pixel) só carregam depois de "Aceitar" e só se estiverem
  // configurados — mas o aviso de cookies aparece sempre.
  const showBanner = decision === null;

  if (!showBanner) return null;

  return (
    // A faixa ocupa a largura toda, mas só o cartão recebe cliques — sem
    // `pointer-events-none` tapava o botão flutuante no canto inferior direito.
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] px-4 pb-4">
      <div className="pointer-events-auto mx-auto flex max-w-3xl flex-col gap-4 rounded-2xl border border-white/10 bg-ink-soft/95 p-5 shadow-2xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-paper/70">
          Usamos cookies para analisar o tráfego e melhorar a sua experiência.
          Pode aceitar ou recusar os cookies de análise.
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => decide("no")}
            className="rounded-full border border-white/15 px-5 py-2 text-sm text-paper/80 transition-colors hover:border-white/40"
          >
            Recusar
          </button>
          <button
            onClick={() => decide("yes")}
            className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-ink transition-transform hover:scale-[1.02]"
          >
            Aceitar
          </button>
        </div>
      </div>
    </div>
  );
}
