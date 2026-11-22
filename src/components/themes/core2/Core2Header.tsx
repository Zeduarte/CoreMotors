"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import type { Branding } from "@/lib/branding";
import type { NavLink } from "@/themes/core2/ui";
import { Core2Icon } from "./icons";

/**
 * Menu de cima do Core2 (como na maqueta): barra branca com o logótipo à
 * esquerda e, à direita, Motas · Moto 4 · Carros · Vender · Contactos e o
 * botão laranja «Ver stock». No telemóvel, o logótipo e o botão de três
 * traços, que abre a lista por baixo.
 */
export function Core2Header({ branding, links }: { branding: Branding; links: NavLink[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Fecha o menu do telemóvel ao mudar de página.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const logo = branding.logoUrl ? (
    <Image
      src={branding.logoUrl}
      alt={branding.companyName}
      width={280}
      height={70}
      priority
      className="h-9 w-auto max-w-[56vw] object-contain md:h-11"
    />
  ) : (
    <span className="text-2xl font-extrabold tracking-tight text-neutral-900">{branding.companyName}</span>
  );

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-neutral-200/80 bg-white/95 backdrop-blur [view-transition-name:site-header]">
      <nav aria-label="Principal" className="container-px flex h-16 items-center justify-between gap-6">
        <Link href="/" aria-label={`${branding.companyName} — página inicial`} className="flex shrink-0 items-center">
          {logo}
        </Link>

        <ul className="hidden items-center gap-9 lg:flex xl:gap-11">
          {links.map((l) => {
            const active = !l.href.includes("?") && (pathname === l.href || pathname.startsWith(`${l.href}/`));
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={`text-[1.0625rem] font-medium transition-colors hover:text-accent ${
                    active ? "text-accent" : "text-neutral-900"
                  }`}
                >
                  {l.label}
                </Link>
              </li>
            );
          })}
          <li>
            <Link
              href="/inventario"
              className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-[1.0625rem] font-semibold text-white shadow-sm transition-[filter] hover:brightness-110"
            >
              <Core2Icon name="tag" className="h-[1.1rem] w-[1.1rem]" /> Ver stock
            </Link>
          </li>
        </ul>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="core2-menu"
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          className="grid h-11 w-11 place-items-center rounded-md text-neutral-900 lg:hidden"
        >
          {open ? (
            <Core2Icon name="close" className="h-7 w-7" />
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
              <path d="M3.5 6h17M3.5 12h17M3.5 18h17" />
            </svg>
          )}
        </button>
      </nav>

      {open && (
        <div id="core2-menu" className="border-t border-neutral-200 bg-white lg:hidden">
          <ul className="container-px flex flex-col py-3">
            {links.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="block border-b border-neutral-100 py-3.5 text-lg font-medium text-neutral-900"
                >
                  {l.label}
                </Link>
              </li>
            ))}
            <li className="pt-4">
              <Link
                href="/inventario"
                onClick={() => setOpen(false)}
                className="flex items-center justify-center gap-2 rounded-md bg-accent py-3 text-base font-semibold text-white"
              >
                <Core2Icon name="tag" className="h-5 w-5" /> Ver stock
              </Link>
            </li>
            <li className="pb-2 pt-3">
              <a
                href={branding.company.phoneHref}
                className="flex items-center justify-center gap-2 rounded-md border border-neutral-300 py-3 text-base font-semibold text-neutral-900"
              >
                <Core2Icon name="phone" className="h-5 w-5 text-accent" /> {branding.company.phone}
              </a>
            </li>
          </ul>
        </div>
      )}
    </header>
  );
}
