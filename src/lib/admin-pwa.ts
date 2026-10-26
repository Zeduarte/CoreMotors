/**
 * PWA do backoffice: o que o site público e o backoffice precisam de saber em
 * comum. O site público desregista qualquer Service Worker antigo (ver
 * SiteRuntime) — mas tem de deixar em paz o do backoffice, que vive em
 * `/admin/sw.js` com âmbito `/admin`.
 */

/**
 * Âmbito da app e do Service Worker do backoffice. Sem barra no fim: o âmbito
 * é um prefixo de texto, e "/admin/" deixava de fora o próprio `/admin` (o
 * dashboard, que é o `start_url` — o Next redirecciona `/admin/` para
 * `/admin`). O Chrome chegava a ignorar o âmbito do manifest por isso.
 * Como é mais largo do que a pasta do script, o SW precisa do cabeçalho
 * `Service-Worker-Allowed: /admin` (next.config.mjs).
 */
export const ADMIN_SCOPE = "/admin";

/** Script do Service Worker do backoffice (em `public/admin/sw.js`). */
export const ADMIN_SW_URL = "/admin/sw.js";

/** Manifest da app do backoffice (src/app/admin/manifest.webmanifest/route.ts). */
export const ADMIN_MANIFEST_URL = "/admin/manifest.webmanifest";

/**
 * Prefixo das caches do backoffice. Hoje o SW não usa Cache Storage (a página
 * "sem ligação" é gerada lá dentro), mas se um dia usar, é com este prefixo —
 * e o site público não lhes toca.
 */
export const ADMIN_CACHE_PREFIX = "coremotors-admin-";

/** O registo (pelo `scope`, um URL absoluto) é o do backoffice? */
export function isAdminServiceWorker(scope: string): boolean {
  try {
    const path = new URL(scope, "http://localhost").pathname;
    return path === ADMIN_SCOPE || path === `${ADMIN_SCOPE}/`;
  } catch {
    return false;
  }
}

/** A cache pertence ao backoffice? */
export function isAdminCache(name: string): boolean {
  return name.startsWith(ADMIN_CACHE_PREFIX);
}

/** Cor de fundo do backoffice (`ink` do tailwind.config.ts). */
export const ADMIN_THEME_COLOR = "#0A0A0A";

/** Ícones da app do backoffice (gerados em `public/admin-icons/`). */
export const ADMIN_ICONS = {
  icon192: "/admin-icons/icon-192.png",
  icon512: "/admin-icons/icon-512.png",
  maskable512: "/admin-icons/maskable-512.png",
  apple: "/admin-icons/apple-touch-icon.png",
} as const;

/**
 * Web App Manifest do backoffice, servido em `/admin/manifest.webmanifest`.
 * Separado do do site (`/manifest.webmanifest`, início em `/`): instalado, o
 * backoffice abre directamente em `/admin` e não "foge" para o site público.
 */
export function adminManifest(companyName: string) {
  return {
    id: "/admin/",
    name: `${companyName} Admin`,
    short_name: companyName,
    description: `Backoffice de ${companyName}`,
    start_url: ADMIN_SCOPE,
    scope: ADMIN_SCOPE,
    display: "standalone",
    orientation: "any",
    background_color: ADMIN_THEME_COLOR,
    theme_color: ADMIN_THEME_COLOR,
    lang: "pt-PT",
    dir: "ltr",
    categories: ["business", "productivity"],
    icons: [
      { src: ADMIN_ICONS.icon192, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: ADMIN_ICONS.icon512, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: ADMIN_ICONS.maskable512, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
