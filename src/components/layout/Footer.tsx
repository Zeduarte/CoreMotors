import Link from "next/link";
import Image from "next/image";
import { siteDescription } from "@/lib/site-types";
import type { VehicleType } from "@/lib/vehicle-categories";
import { DEFAULT_BRANDING, type Branding } from "@/lib/branding";
import { EMPTY_LEGAL, legalLine, type LegalInfo } from "@/lib/legal";
import type { ThemeId } from "@/themes/index";
import { ManageCookiesButton } from "@/components/site/ManageCookiesButton";

// Links obrigatórios do rodapé. As políticas são páginas internas do site; o
// Livro de Reclamações é o portal oficial (externo).
const LEGAL_LINKS: { label: string; href: string; external?: boolean }[] = [
  {
    label: "Livro de Reclamações",
    href: "https://www.livroreclamacoes.pt/Inicio/",
    external: true,
  },
  { label: "Política de Privacidade", href: "/politica-de-privacidade" },
  { label: "Política de Cookies", href: "/politica-de-cookies" },
  { label: "Termos e Condições", href: "/termos-condicoes" },
];

// A navegação do rodapé. No Core3 os serviços estão na página inicial (sem
// menu), e o Sobre e o «Veículo ideal» saem do menu para aqui.
const CORE_LINKS = [
  { label: "Stock", href: "/inventario" },
  { label: "Serviços", href: "/servicos" },
  { label: "Sobre", href: "/sobre" },
  { label: "Contactos", href: "/contactos" },
];
const CORE3_LINKS = [
  { label: "Stock", href: "/inventario" },
  { label: "Veículo ideal", href: "/quiz" },
  { label: "Sobre", href: "/sobre" },
  { label: "Contactos", href: "/contactos" },
];

export function Footer({
  theme = "core",
  branding = DEFAULT_BRANDING,
  legal = EMPTY_LEGAL,
  background = null,
  siteTypes = ["car", "motorcycle"],
}: {
  theme?: ThemeId;
  branding?: Branding;
  /** Nome legal e NIF (Definições → Empresa). */
  legal?: LegalInfo;
  /** rodape.jpg do tipo principal do site, se existir. */
  background?: string | null;
  /** O que o site vende (para a frase de apresentação). */
  siteTypes?: VehicleType[];
}) {
  return (
    // `site-dark`: no modo claro fica como no escuro (foto de fundo com texto por cima).
    <footer className="site-dark relative overflow-hidden border-t border-white/10 bg-ink">
      {/* Imagem de fundo subtil (rodape.jpg em public/media/carros|motas/) + escurecimento
          forte para manter o texto legível. Fallback: fica só o fundo escuro. */}
      {background && (
        <div
          aria-hidden
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${background})` }}
        />
      )}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/70 to-ink/55"
      />
      {/* No modo claro, o branco do site entra a desvanecer por cima da foto
          (no escuro não aparece). */}
      <div
        aria-hidden
        className="site-fade pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-t from-transparent to-[rgb(var(--site-page))]"
      />

      <div className="relative z-10 container-px grid gap-12 py-16 [text-shadow:0_1px_4px_rgba(0,0,0,0.7)] md:grid-cols-4 md:py-20">
        <div className="md:col-span-2">
          {branding.logoUrl ? (
            <Image
              src={branding.logoUrl}
              alt={branding.companyName}
              width={300}
              height={75}
              className="h-14 w-auto max-w-full object-contain md:h-16"
            />
          ) : (
            <p className="text-2xl font-bold tracking-tight text-paper">
              {branding.companyName}
            </p>
          )}
          <p className="mt-4 max-w-sm text-sm text-paper/85">
            {branding.tagline || siteDescription(siteTypes)}
          </p>
        </div>

        <div>
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-paper/70">
            Navegação
          </h2>
          <ul className="mt-4 space-y-3 text-sm">
            {(theme === "core3" ? CORE3_LINKS : CORE_LINKS).map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="font-medium text-paper transition-colors hover:text-accent">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-paper/70">
            Contactos
          </h2>
          <ul className="mt-4 space-y-3 text-sm font-medium text-paper/90">
            <li>
              <a href={branding.company.phoneHref} className="hover:text-paper">
                {branding.company.phone}
              </a>
            </li>
            <li>
              <a
                href={`mailto:${branding.company.email}`}
                className="hover:text-paper"
              >
                {branding.company.email}
              </a>
            </li>
            <li>
              {branding.company.address.street},{" "}
              {branding.company.address.postalCode}{" "}
              {branding.company.address.city}
            </li>
            <li className="text-paper/70">{branding.company.hours}</li>
          </ul>
        </div>
      </div>

      <div className="relative z-10 border-t border-white/5">
        <div className="container-px flex flex-col items-center justify-between gap-3 py-6 text-xs text-paper/75 [text-shadow:0_1px_4px_rgba(0,0,0,0.7)] md:flex-row">
          <p className="text-center md:text-left">
            {legalLine(legal, branding.companyName)} | Copyright © {new Date().getFullYear()}
          </p>
          <nav className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 uppercase tracking-wide">
            {LEGAL_LINKS.map((l) => (
              <span key={l.label} className="flex items-center gap-3">
                {l.external ? (
                  <a
                    href={l.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-paper/80 transition-colors hover:text-paper"
                  >
                    {l.label}
                  </a>
                ) : (
                  // Páginas legais: raramente abertas, não se pré-carregam.
                  <Link
                    href={l.href}
                    prefetch={false}
                    className="font-medium text-paper/80 transition-colors hover:text-paper"
                  >
                    {l.label}
                  </Link>
                )}
                <span aria-hidden className="text-paper/40">
                  ·
                </span>
              </span>
            ))}
            {/* Reabre o banner de cookies (mudar ou retirar o consentimento). */}
            <ManageCookiesButton className="font-medium uppercase tracking-wide text-paper/80 transition-colors hover:text-paper" />
          </nav>
        </div>
      </div>
    </footer>
  );
}
