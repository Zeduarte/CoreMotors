/** @type {import('next').NextConfig} */

// Quando publicamos no GitHub Pages, o build corre em modo de exportação
// estática (`EXPORT=true`) e o site vive num subcaminho (`/nome-do-repo`),
// injetado via `NEXT_PUBLIC_BASE_PATH`. Localmente estas variáveis não existem,
// por isso o `next dev`/`next build` normais não são afetados.
const isExport = process.env.EXPORT === "true";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

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
      "cookie=engineline_public_type,header=RSC|Next-Router-State-Tree|Next-Router-Prefetch|Next-Router-Segment-Prefetch",
  },
  // `public-data` e `branding`: as etiquetas de src/lib/public-cache.ts e de
  // getBranding; `_N_T_/layout`: revalidatePath("/", "layout").
  { key: "Netlify-Cache-Tag", value: "public-data,branding,_N_T_/layout" },
];

const nextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_SITE_URL: siteUrl },
  // A exportação estática não tem servidor nem cabeçalhos.
  ...(isExport
    ? {}
    : {
        async headers() {
          return PUBLIC_PAGES.map((source) => ({ source, headers: publicCdnHeaders }));
        },
      }),
  ...(isExport ? { output: "export" } : {}),
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  images: {
    // A exportação estática não tem servidor de otimização de imagens.
    unoptimized: isExport,
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
