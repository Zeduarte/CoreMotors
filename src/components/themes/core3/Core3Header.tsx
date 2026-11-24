"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { DEFAULT_BRANDING, type Branding } from "@/lib/branding";
import { useLocalList, FAVORITES_KEY } from "@/hooks/useLocalList";
import { NAV_START_EVENT, type NavStartDetail } from "@/lib/page-transition";
import type { Core3Category } from "@/themes/core3/ui";


/** A página aberta pertence a este item do menu? */
function isActive(href: string, path: string): boolean {
  return path === href || path.startsWith(`${href}/`);
}

/**
 * O menu do Core3 (como na maqueta): o logótipo (leva ao início), as páginas
 * de stock por tipo (sem stock misturado), «Vender» («Compramos o seu
 * veículo») e «Contactos». O sublinhado do item aberto salta logo para o clicado, enquanto o
 * deslize entre páginas corre (ver `template.tsx`).
 */
export function Core3Header({
  branding = DEFAULT_BRANDING,
  categories,
  stockSlugs,
}: {
  branding?: Branding;
  /** As páginas de stock que o site tem (Motas, Moto 4, Carros). */
  categories: Pick<Core3Category, "key" | "href" | "short">[];
  /** As viaturas no site agora: o contador dos favoritos conta só estas. */
  stockSlugs?: string[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const activePath = pendingPath ?? pathname;
  const { items: favorites, ready } = useLocalList(FAVORITES_KEY);
  const inStock = useMemo(() => (stockSlugs ? new Set(stockSlugs) : null), [stockSlugs]);
  const favCount = ready ? (inStock ? favorites.filter((s) => inStock.has(s)).length : favorites.length) : 0;

  const nav = [
    ...categories.map((c) => ({ href: c.href, label: c.short })),
    // «Compramos o seu veículo» (a avaliação da retoma).
    { href: "/vender", label: "Vender" },
    { href: "/contactos", label: "Contactos" },
  ];

  useEffect(() => {
    const onStart = (e: Event) => setPendingPath((e as CustomEvent<NavStartDetail>).detail.pathname);
    window.addEventListener(NAV_START_EVENT, onStart);
    return () => window.removeEventListener(NAV_START_EVENT, onStart);
  }, []);

  // Fecha o menu do telemóvel ao navegar.
  useEffect(() => {
    setOpen(false);
    setPendingPath(null);
  }, [pathname]);


  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-ink-soft/90 backdrop-blur-xl [view-transition-name:site-header]">
      <nav className="mx-auto flex h-16 w-full max-w-content items-center justify-between gap-4 px-4 md:px-6">
        <Link href="/" aria-label={`${branding.companyName} — página inicial`} className="flex shrink-0 items-center text-lg font-bold text-paper">
          {branding.logoUrl ? (
            <Image
              src={branding.logoUrl}
              alt={branding.companyName}
              width={280}
              height={70}
              priority
              className="h-9 w-auto max-w-[50vw] object-contain md:h-11"
            />
          ) : (
            <span>{branding.companyName}</span>
          )}
        </Link>

        <ul className="hidden items-center gap-8 md:flex">
          {nav.map((item) => {
            const active = isActive(item.href, activePath);
            return (
              <li key={item.label}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative text-sm font-medium transition-colors duration-300 ${active ? "text-paper" : "text-paper/60 hover:text-paper"}`}
                >
                  {item.label}
                  {active && (
                    <motion.span
                      layoutId="core3-underline"
                      transition={{ type: "spring", stiffness: 380, damping: 34 }}
                      className="absolute -bottom-2 left-0 h-0.5 w-full rounded-full bg-accent"
                    />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-2">
          <Link
            href="/favoritos"
            prefetch={false}
            aria-label={`Favoritos${favCount ? ` (${favCount})` : ""}`}
            className="relative hidden h-10 w-10 place-items-center rounded-full border border-white/15 text-paper/70 transition-colors hover:border-rose-400/50 hover:text-rose-300 md:grid"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill={favCount ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.5s-7.5-4.7-9.6-9C1.1 8.7 2.4 5.6 5.4 5c1.9-.4 3.7.5 4.6 2 .9-1.5 2.7-2.4 4.6-2 3 .6 4.3 3.7 3 6.5-2.1 4.3-9.6 9-9.6 9z" />
            </svg>
            {favCount > 0 && (
              <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                {favCount}
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="core3-menu"
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            className="grid h-10 w-10 place-items-center md:hidden"
          >
            <span className="relative block h-4 w-6">
              <span className={`absolute left-0 block h-0.5 w-6 bg-paper transition-all duration-300 ${open ? "top-1.5 rotate-45" : "top-0"}`} />
              <span className={`absolute left-0 top-1.5 block h-0.5 w-6 bg-paper transition-opacity duration-300 ${open ? "opacity-0" : "opacity-100"}`} />
              <span className={`absolute left-0 block h-0.5 w-6 bg-paper transition-all duration-300 ${open ? "top-1.5 -rotate-45" : "top-3"}`} />
            </span>
          </button>
        </div>
      </nav>

      {open && (
        <ul id="core3-menu" className="flex flex-col gap-1 border-t border-white/10 px-4 pb-4 pt-3 md:hidden">
          {[
            ...nav,
            { href: "/quiz", label: "Veículo ideal" },
            { href: "/favoritos", label: favCount ? `Favoritos (${favCount})` : "Favoritos" },
          ].map((item) => (
            <li key={item.label}>
              <Link
                href={item.href}
                prefetch={item.href === "/favoritos" ? false : undefined}
                aria-current={isActive(item.href, activePath) ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-2 py-3 text-lg font-medium ${isActive(item.href, activePath) ? "text-paper" : "text-paper/80"}`}
              >
                <span aria-hidden className={`h-5 w-0.5 rounded-full ${isActive(item.href, activePath) ? "bg-accent" : "bg-transparent"}`} />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}
