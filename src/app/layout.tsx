import { THEME_INIT_SCRIPT } from "@/components/admin/theme-init";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { site } from "@/lib/site";
import { getBranding, getSiteVehicleTypes } from "@/lib/queries";
import { siteDescription, vehiclesLabel } from "@/lib/site-types";
import { SiteRuntime } from "@/components/site/SiteRuntime";
import { BrandIdentityProvider } from "@/components/layout/BrandIdentity";

// next/font: auto-host, sem pedido a terceiros, sem layout shift. Exposto
// como CSS var e consumido pelo Tailwind (font-sans).
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

// O título e a descrição dizem o que o stand vende (Definições → Tipo de site).
export async function generateMetadata(): Promise<Metadata> {
  const types = await getSiteVehicleTypes();
  const label = vehiclesLabel(types);
  const description = siteDescription(types);
  return {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — ${label} em Portugal`,
    template: `%s · ${site.name}`,
  },
  description,
  openGraph: {
    type: "website",
    locale: "pt_PT",
    siteName: site.name,
    title: `${site.name} — ${label}`,
    description,
    url: site.url,
  },
  robots: { index: true, follow: true },
  // Ver src/app/manifest.webmanifest/route.ts (o backoffice tem o seu).
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", shortcut: "/icon.svg", apple: "/icon.svg" },
  };
}

export const viewport: Viewport = {
  themeColor: "#0A0A0A",
  colorScheme: "dark",
};

/**
 * Root layout mínimo: apenas `<html>/<body>`, fontes e o Toaster global.
 * A "chrome" do site público (Header/Footer/Lenis) vive em `(public)/layout`;
 * o backoffice tem a sua própria em `admin/layout`.
 */
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const branding = await getBranding();

  // `data-admin-theme` é posto no <html> por um script antes da 1.ª pintura (backoffice);
  // o React não o conhece, por isso a diferença é esperada (suppressHydrationWarning).
  return (
    <html lang="pt-PT" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Tema do backoffice antes da 1.ª pintura (também depois de um login sem recarregar). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-ink font-sans antialiased">
        {/* Cores da marca escolhidas no backoffice — sobrepõem os defaults. */}
        <style
          dangerouslySetInnerHTML={{
            __html: `:root{--accent:${branding.accent};--accent-soft:${branding.accentSoft};}`,
          }}
        />
        {/* A marca para as páginas de erro, que correm no browser. */}
        <BrandIdentityProvider
          value={{ companyName: branding.companyName, logoUrl: branding.logoUrl }}
        >
          {children}
        </BrandIdentityProvider>
        <SiteRuntime ga4Id={branding.ga4Id} pixelId={branding.pixelId} />
        <Toaster
          theme="dark"
          position="top-right"
          toastOptions={{
            style: {
              background: "#111112",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#F5F5F4",
            },
          }}
        />
      </body>
    </html>
  );
}
