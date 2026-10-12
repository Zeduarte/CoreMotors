import Link from "next/link";
import Image from "next/image";
import { site } from "@/lib/site";
import { DEFAULT_BRANDING, type Branding } from "@/lib/branding";
import { LEGAL_NAME, NIF } from "@/lib/legal";

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
  { label: "Termos de Condições", href: "/termos-condicoes" },
];

export function Footer({
  branding = DEFAULT_BRANDING,
  background = null,
}: {
  branding?: Branding;
  /** rodape.jpg do mundo escolhido, se existir. */
  background?: string | null;
}) {
  return (
    <footer className="relative overflow-hidden border-t border-white/10 bg-ink">
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
            {branding.tagline || site.description}
          </p>
        </div>

        <div>
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-paper/70">
            Navegação
          </h2>
          <ul className="mt-4 space-y-3 text-sm">
            <li>
              <Link
                href="/inventario"
                className="font-medium text-paper transition-colors hover:text-accent"
              >
                Stock
              </Link>
            </li>
            <li>
              <Link href="/servicos" className="text-paper/60 hover:text-paper">
                Serviços
              </Link>
            </li>
            <li>
              <Link
                href="/sobre"
                className="font-medium text-paper transition-colors hover:text-accent"
              >
                Sobre
              </Link>
            </li>
            <li>
              <Link
                href="/contactos"
                className="font-medium text-paper transition-colors hover:text-accent"
              >
                Contactos
              </Link>
            </li>
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
            {LEGAL_NAME} | NIF: {NIF} | Copyright © {new Date().getFullYear()}
          </p>
          <nav className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 uppercase tracking-wide">
            {LEGAL_LINKS.map((l, i) => (
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
                {i < LEGAL_LINKS.length - 1 && (
                  <span aria-hidden className="text-paper/40">
                    ·
                  </span>
                )}
              </span>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
