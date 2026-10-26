import type { Metadata, Viewport } from "next";
import { getBranding } from "@/lib/queries";
import { site } from "@/lib/site";
import {
  ADMIN_ICONS,
  ADMIN_MANIFEST_URL,
  ADMIN_THEME_COLOR,
} from "@/lib/admin-pwa";
import { PwaRegister } from "@/components/admin/PwaRegister";

// O backoffice nunca deve ser indexado. Tem o seu próprio manifest (app
// instalável que abre em /admin), que substitui o do site nestas páginas.
export const metadata: Metadata = {
  title: "Backoffice",
  robots: { index: false, follow: false },
  manifest: ADMIN_MANIFEST_URL,
  icons: {
    icon: [{ url: ADMIN_ICONS.icon192, sizes: "192x192", type: "image/png" }],
  },
};

// `viewport-fit=cover`: em modo app, o conteúdo ocupa o ecrã todo (incluindo a
// zona do notch) e cada barra afasta-se com os safe-area insets.
export const viewport: Viewport = {
  themeColor: ADMIN_THEME_COLOR,
  colorScheme: "dark",
  viewportFit: "cover",
};

export default async function AdminRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  let companyName: string = site.name;
  try {
    companyName = (await getBranding()).companyName || site.name;
  } catch {
    /* sem Supabase: fica o nome por defeito */
  }

  return (
    <>
      {/* As tags da app vão aqui e não só no `metadata`: o Next 15 envia o
          metadata em streaming e, numa página rápida como o login, ele chega
          depois do <head> e fica no <body> — onde o Chrome não procura o
          manifest e o iOS não lê as `apple-mobile-web-app-*`. Daqui, o React
          põe-nas sempre no <head>. */}
      <link rel="manifest" href={ADMIN_MANIFEST_URL} />
      <link rel="apple-touch-icon" href={ADMIN_ICONS.apple} sizes="180x180" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-title" content={companyName} />
      {/* A página desenha por baixo da barra de estado do iPhone; a folga
          fica a cargo de `env(safe-area-inset-*)` (ver MobileNav). */}
      <meta
        name="apple-mobile-web-app-status-bar-style"
        content="black-translucent"
      />
      {children}
      <PwaRegister />
    </>
  );
}
