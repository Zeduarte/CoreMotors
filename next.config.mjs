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

const nextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_SITE_URL: siteUrl },
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
