import Link from "next/link";
import Image from "next/image";
import type { Branding } from "@/lib/branding";
import { LEGAL_NAME, NIF } from "@/lib/legal";
import { ManageCookiesButton } from "@/components/site/ManageCookiesButton";
import { callNotice, socialLinks } from "@/themes/core2/ui";
import { Core2Icon } from "./icons";

// Obrigatórios por lei (o Livro de Reclamações) e as políticas do site: numa
// linha pequena por baixo, fora da maqueta.
const LEGAL_LINKS: { label: string; href: string; external?: boolean }[] = [
  { label: "Livro de Reclamações", href: "https://www.livroreclamacoes.pt/Inicio/", external: true },
  { label: "Política de Privacidade", href: "/politica-de-privacidade" },
  { label: "Política de Cookies", href: "/politica-de-cookies" },
  { label: "Termos e Condições", href: "/termos-condicoes" },
];

/**
 * Rodapé do Core2 (como na maqueta): logótipo, Morada, Telefone (com o aviso
 * do custo da chamada), E-mail e «Siga-nos». No telemóvel, em duas linhas: o
 * logótipo com a morada e, por baixo, o telefone, o e-mail e as redes.
 */
export function Core2Footer({ branding, placeName }: { branding: Branding; placeName?: string | null }) {
  const c = branding.company;
  const notice = callNotice(c.phone);
  const social = socialLinks(branding);
  const logo = branding.logoUrl ? (
    <Image src={branding.logoUrl} alt={branding.companyName} width={300} height={75} className="h-10 w-auto max-w-full object-contain md:h-12" />
  ) : (
    <span className="text-2xl font-extrabold tracking-tight text-neutral-900">{branding.companyName}</span>
  );
  const socialIcons = social.length > 0 && (
    <ul className="flex items-center gap-4">
      {social.map((s) => (
        <li key={s.network}>
          <a href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label} className="text-accent transition-opacity hover:opacity-80">
            <Core2Icon name={s.network} className="h-7 w-7" strokeWidth={1.8} />
          </a>
        </li>
      ))}
    </ul>
  );

  return (
    <footer className="border-t border-neutral-200 bg-white text-neutral-800">
      {/* Computador: tudo numa linha, com separadores. */}
      <div className="container-px hidden items-center gap-10 py-7 md:flex">
        <div className="shrink-0 pr-2">{logo}</div>
        <span aria-hidden className="h-14 w-px bg-neutral-200" />
        <div className="grid flex-1 grid-cols-3 gap-8 text-sm">
          <FooterItem icon="pin" title="Morada">
            <p>{c.address.street}</p>
            <p>
              {c.address.postalCode} {c.address.city}
              {c.address.country ? `, ${c.address.country}` : ""}
            </p>
          </FooterItem>
          <FooterItem icon="phone" title="Telefone">
            <p>
              <a href={c.phoneHref} className="hover:text-accent">
                {c.phone}
              </a>
            </p>
            {notice && <p className="text-xs text-neutral-500">{notice}</p>}
          </FooterItem>
          <FooterItem icon="mail" title="E-mail">
            <p>
              <a href={`mailto:${c.email}`} className="hover:text-accent">
                {c.email}
              </a>
            </p>
          </FooterItem>
        </div>
        {socialIcons && (
          <>
            <span aria-hidden className="h-14 w-px bg-neutral-200" />
            <div className="shrink-0 text-center">
              <p className="mb-2 text-sm font-semibold text-neutral-900">Siga-nos</p>
              {socialIcons}
            </div>
          </>
        )}
      </div>

      {/* Telemóvel: logótipo e morada; por baixo, telefone, e-mail e redes. */}
      <div className="container-px py-6 md:hidden">
        <div className="flex items-center gap-4">
          <div className="w-[42%] shrink-0">{logo}</div>
          <span aria-hidden className="h-12 w-px bg-neutral-200" />
          <div className="flex min-w-0 gap-2 text-[0.8rem] leading-snug">
            <Core2Icon name="pin" className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <div className="min-w-0">
              <p className="font-semibold text-neutral-900">{placeName || "Morada"}</p>
              <p>{c.address.street}</p>
              <p>
                {c.address.postalCode} {c.address.city}
              </p>
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
          <div>
            <a href={c.phoneHref} className="flex items-center gap-2 text-lg font-bold text-neutral-900">
              <Core2Icon name="phone" className="h-5 w-5 text-accent" /> {c.phone}
            </a>
            {notice && <p className="pl-7 text-[0.7rem] text-neutral-500">{notice}</p>}
          </div>
          <span aria-hidden className="h-8 w-px bg-neutral-200" />
          <a href={`mailto:${c.email}`} className="flex min-w-0 items-center gap-2 text-sm">
            <Core2Icon name="mail" className="h-5 w-5 shrink-0 text-accent" />
            <span className="truncate">{c.email}</span>
          </a>
          {socialIcons && (
            <>
              <span aria-hidden className="h-8 w-px bg-neutral-200" />
              {socialIcons}
            </>
          )}
        </div>
      </div>

      <div className="border-t border-neutral-100">
        <div className="container-px flex flex-col items-center justify-between gap-2 py-4 text-[0.7rem] text-neutral-500 md:flex-row">
          <p className="text-center md:text-left">
            {LEGAL_NAME} | NIF: {NIF} | Copyright © {new Date().getFullYear()}
          </p>
          <nav aria-label="Informação legal" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            {LEGAL_LINKS.map((l) =>
              l.external ? (
                <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className="hover:text-neutral-800">
                  {l.label}
                </a>
              ) : (
                <Link key={l.label} href={l.href} prefetch={false} className="hover:text-neutral-800">
                  {l.label}
                </Link>
              ),
            )}
            <ManageCookiesButton className="hover:text-neutral-800" />
          </nav>
        </div>
      </div>
    </footer>
  );
}

function FooterItem({ icon, title, children }: { icon: "pin" | "phone" | "mail"; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Core2Icon name={icon} className="mt-0.5 h-6 w-6 shrink-0 text-accent" />
      <div className="min-w-0 leading-relaxed">
        <p className="font-semibold text-neutral-900">{title}</p>
        {children}
      </div>
    </div>
  );
}
