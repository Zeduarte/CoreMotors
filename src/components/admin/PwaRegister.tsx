"use client";

import { useEffect } from "react";
import { ADMIN_SCOPE, ADMIN_SW_URL } from "@/lib/admin-pwa";

/**
 * Regista o Service Worker do backoffice (app instalável + página "sem
 * ligação"). Só em produção: em `next dev` um SW só atrapalhava o hot reload.
 * Está no layout de `/admin`, por isso também corre no login.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    try {
      navigator.serviceWorker
        .register(ADMIN_SW_URL, { scope: ADMIN_SCOPE })
        .catch(() => {});
    } catch {
      /* ignora: sem SW o backoffice funciona na mesma */
    }
  }, []);

  return null;
}
