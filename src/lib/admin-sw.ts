import { ADMIN_CACHE_PREFIX, ADMIN_SCOPE, ADMIN_THEME_COLOR } from "@/lib/admin-pwa";

/*
 * Service Worker do backoffice (âmbito /admin), servido por
 * src/app/admin/sw.js/route.ts e não como ficheiro em `public/`: o Netlify
 * serve os ficheiros estáticos sem os cabeçalhos do next.config.mjs, e sem
 * `Service-Worker-Allowed` o browser recusa o âmbito `/admin` (mais largo do
 * que a pasta do script) — o SW não ficava registado e a app não se instalava.
 *
 * Existe só para o backoffice poder ser instalado como app e para mostrar uma
 * página "sem ligação" em vez do erro do browser. NÃO faz cache de nada:
 * páginas, `_next/static`, pedidos RSC e Server Actions vão sempre à rede.
 * (Um SW antigo do site guardava chunks em cache e dava "Server Action not
 * found" depois de cada deploy — ver public/sw.js.)
 *
 * Se um dia precisar de Cache Storage, usar o prefixo `coremotors-admin-`:
 * o site público (SiteRuntime) apaga todas as outras caches.
 */

/** Cabeçalhos do script: nunca em cache, e autorizado a controlar `/admin`. */
export const ADMIN_SW_HEADERS = {
  "Content-Type": "application/javascript; charset=utf-8",
  "Cache-Control": "no-cache, no-store, must-revalidate",
  "Service-Worker-Allowed": ADMIN_SCOPE,
} as const;

const OFFLINE_HTML = `<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="${ADMIN_THEME_COLOR}">
<title>Sem ligação</title>
<style>
  html,body{margin:0;height:100%;background:${ADMIN_THEME_COLOR};color:#F5F5F4;font-family:system-ui,-apple-system,sans-serif}
  main{min-height:100%;display:grid;place-items:center;text-align:center;padding:24px;box-sizing:border-box}
  h1{font-size:1.25rem;margin:0 0 8px}
  p{margin:0 0 24px;color:rgba(245,245,244,.6);font-size:.9rem}
  button{font:inherit;font-weight:600;border:0;border-radius:999px;padding:12px 24px;background:#F2811D;color:#0A0A0A;cursor:pointer}
</style>
</head>
<body>
<main>
  <div>
    <h1>Sem ligação à internet</h1>
    <p>Verifique a ligação e tente novamente.</p>
    <button type="button" onclick="location.reload()">Tentar novamente</button>
  </div>
</main>
</body>
</html>`;

/** O código do Service Worker, tal como o browser o recebe. */
export const ADMIN_SW_SOURCE = `/* CoreMotors — Service Worker do backoffice (âmbito ${ADMIN_SCOPE}). Ver src/lib/admin-sw.ts. */
const CACHE_PREFIX = ${JSON.stringify(ADMIN_CACHE_PREFIX)};
const OFFLINE_HTML = ${JSON.stringify(OFFLINE_HTML)};

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Caches de versões anteriores deste SW (só as do backoffice).
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => caches.delete(k)),
        );
      } catch {
        /* ignora */
      }
      // O pedido da página arranca em paralelo com o arranque do SW.
      try {
        await self.registration.navigationPreload?.enable();
      } catch {
        /* ignora */
      }
      await self.clients.claim();
    })(),
  );
});

// Só as navegações (abrir uma página do backoffice). Tudo o resto — chunks,
// RSC, Server Actions, imagens, Supabase — nem passa por aqui: o browser
// trata do pedido como se não houvesse SW.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.mode !== "navigate" || request.method !== "GET") return;

  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;
        return await fetch(request);
      } catch {
        return new Response(OFFLINE_HTML, {
          status: 503,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }
    })(),
  );
});
`;
