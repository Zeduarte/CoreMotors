"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import type { Core3Category } from "@/themes/core3/ui";

/**
 * Core3, no telemóvel: Motas · Moto 4 · Carros fixos em baixo, para trocar de
 * página com o polegar (o deslize entre elas é o de sempre). Não aparece na
 * ficha de viatura, que tem a sua barra de contacto no mesmo sítio.
 *
 * A barra guarda a sua altura em `--core3-nav` (o botão do WhatsApp e a barra
 * de comparação sobem por cima dela, ver core3.css) e reserva esse espaço no
 * fim da página, para não tapar o rodapé.
 */
export function Core3MobileNav({ categories }: { categories: Pick<Core3Category, "key" | "href" | "short">[] }) {
  const pathname = usePathname();
  const bar = useRef<HTMLElement>(null);
  const hidden = /^\/viaturas\/[^/]+\/?$/.test(pathname) || categories.length < 2;

  useEffect(() => {
    const el = bar.current;
    if (hidden || !el) return;
    const root = document.documentElement;
    const before = document.body.style.paddingBottom;
    const apply = () => {
      // Só no telemóvel: no computador a barra está escondida (altura 0).
      const h = el.offsetHeight;
      root.style.setProperty("--core3-nav", `${h}px`);
      document.body.style.paddingBottom = h ? `${h}px` : before;
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--core3-nav");
      document.body.style.paddingBottom = before;
    };
  }, [hidden]);

  if (hidden) return null;

  return (
    <nav
      ref={bar}
      aria-label="Categorias"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink-soft/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <ul className="mx-auto grid max-w-md gap-1.5 px-3 py-2" style={{ gridTemplateColumns: `repeat(${categories.length}, minmax(0, 1fr))` }}>
        {categories.map((c) => {
          const active = pathname === c.href || pathname.startsWith(`${c.href}/`);
          return (
            <li key={c.key}>
              <Link
                href={c.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-11 items-center justify-center rounded-xl text-sm font-semibold transition-colors ${
                  active ? "bg-accent text-ink" : "text-paper/75 active:bg-white/10"
                }`}
              >
                {c.short}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
