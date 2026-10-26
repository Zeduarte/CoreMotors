/** @type {import('next').NextConfig} */

// O endereço público do site (links partilhados, QR da ficha, sitemap,
// canónicos). Primeiro o das variáveis do Netlify; sem ele, `URL`, o domínio
// principal que o Netlify dá ao site no build (o domínio próprio, quando há).
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.URL || "";

// Páginas públicas guardadas na CDN do Netlify. Leem o cookie carros/motas, por
// isso o Next gera-as a cada visita — e cada visita acordava a função nos EUA
// (com o Supabase na Europa). Assim a CDN guarda uma cópia por mundo
// (`cookie=`) e serve-a logo; passado um minuto, a visita seguinte ainda
// recebe a cópia guardada enquanto a nova é gerada por trás. Quando o
// backoffice, o WhatsApp ou a manutenção mudam o site, `revalidateTag` /
// `revalidatePath` apagam estas cópias pelas etiquetas (`Netlify-Cache-Tag`):
// a alteração aparece logo, sem esperar o minuto.
const PUBLIC_PAGES = [
  "/",
  "/inventario",
  "/carros/:path*",
  "/motas/:path*",
  "/viaturas/:path*",
  "/vendidos",
  "/comparar",
  "/favoritos",
  "/contactos",
  "/sobre",
  "/servicos/:path*",
  "/vender",
  "/quiz",
  "/politica-de-cookies",
  "/politica-de-privacidade",
  "/termos-condicoes",
];
const publicCdnHeaders = [
  {
    key: "Netlify-CDN-Cache-Control",
    value: "public, s-maxage=60, stale-while-revalidate=604800, durable",
  },
  // O mundo escolhido e os pedidos de navegação do Next (RSC) têm respostas
  // diferentes para o mesmo endereço.
  {
    key: "Netlify-Vary",
    value:
      "cookie=coremotors_public_type,header=RSC|Next-Router-State-Tree|Next-Router-Prefetch|Next-Router-Segment-Prefetch",
  },
  // `public-data` e `branding`: as etiquetas de src/lib/public-cache.ts e de
  // getBranding; `_N_T_/layout`: revalidatePath("/", "layout").
  { key: "Netlify-Cache-Tag", value: "public-data,branding,_N_T_/layout" },
];

// Cabeçalhos de segurança, aplicados a todas as rotas.
// A CSP vai em modo `Report-Only` de propósito: o site depende de scripts
// inline (layout.tsx, WorldArrival.tsx, JSON-LD), de scripts de terceiros
// carregados em runtime (GA4, Meta Pixel, SDK do Facebook), de mapas
// (iframes Google, tiles ArcGIS/OSM no backoffice), do Supabase e de imagens e
// vídeo de vários hosts. Uma CSP imposta sem nonces (que obrigariam a render
// dinâmico e a perder a cache da CDN) arriscava partir o site; assim o browser
// só regista violações na consola, sem bloquear nada. Passar a
// `Content-Security-Policy` quando a consola estiver limpa.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://www.facebook.com https://connect.facebook.net",
  "frame-src 'self' https://www.google.com https://maps.google.com https://www.facebook.com https://web.facebook.com",
  // Service Worker e manifest da app do backoffice (/admin/sw.js,
  // /admin/manifest.webmanifest) — do próprio domínio.
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");
const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nada no site usa câmara, microfone ou geolocalização (o seletor de fotos
  // usa <input type="file">, que não depende da Permissions-Policy).
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy },
];

const nextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_SITE_URL: siteUrl },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      ...PUBLIC_PAGES.map((source) => ({ source, headers: publicCdnHeaders })),
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "**.supabase.co" },
    ],
    formats: ["image/avif", "image/webp"],
  },
  experimental: {
    optimizePackageImports: ["framer-motion", "gsap"],
    // Transições entre páginas com <ViewTransition> do React (ver
    // src/components/ui/ViewTransition.tsx). O React só tira a "fotografia"
    // da página quando a nova já está pronta: durante o pedido ao servidor a
    // página antiga continua viva (barra de progresso, estados de clique).
    viewTransition: true,
  },
  // As imagens e vídeos de public/ são servidos pela CDN; nunca devem ir dentro
  // da função do servidor (o Netlify recusa funções com mais de 250 MB).
  outputFileTracingExcludes: {
    "*": ["public/**/*"],
  },
};

export default nextConfig;
