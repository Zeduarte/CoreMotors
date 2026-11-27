"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { motion } from "framer-motion";

/**
 * Core3, no telemóvel: Motas · Moto 4 · Carros numa cápsula flutuante em
 * baixo (o mesmo vidro do cabeçalho), para trocar entre as três com o polegar
 * (com o deslize de sempre). Só aparece dentro dessas páginas (e no stock geral, `/inventario`) — não na
 * inicial, na ficha de viatura nem nas outras: liga as três entre si.
 *
 * A barra guarda a sua altura em `--core3-nav` (o botão do WhatsApp e a barra
 * de comparação sobem por cima dela, ver core3.css) e reserva esse espaço no
 * fim da página, para não tapar o rodapé.
 */
export function Core3MobileNav({
  items,
  everywhere = false,
}: {
  items: { href: string; label: string }[];
  /** Menu em baixo (Gestão): as opções do menu (sem Contactos), em todas as páginas menos a ficha da viatura. */
  everywhere?: boolean;
}) {
  const pathname = usePathname();
  const bar = useRef<HTMLElement>(null);
  // Só dentro das páginas de stock por tipo: liga-as entre si (entra-se nelas
  // pelos cartões da página inicial ou pelo menu de cima).
  const inCategory =
    pathname === "/inventario" || items.some((c) => pathname === c.href || pathname.startsWith(`${c.href}/`));
  // Na ficha da viatura a barra fixa do fundo (contactar) ocupa o lugar desta.
  const onVehiclePage = /^\/viaturas\/[^/]+/.test(pathname);
  const hidden = items.length < 2 || (everywhere ? onVehiclePage : !inCategory);
  const compact = items.length > 3;

  useEffect(() => {
    const el = bar.current;
    if (hidden || !el) return;
    const root = document.documentElement;
    const before = document.body.style.paddingBottom;
    const apply = () => {
      // Só no telemóvel: no computador a barra está escondida (altura 0).
      const h = el.offsetHeight;
      root.style.setProperty("--core3-nav", `${h}px`);
      // O botão do WhatsApp fica ao lado da cápsula, à mesma altura.
      root.dataset.core3Nav = "side";
      document.body.style.paddingBottom = h ? `${h}px` : before;
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--core3-nav");
      delete root.dataset.core3Nav;
      document.body.style.paddingBottom = before;
    };
  }, [hidden]);

  if (hidden) return null;

  return (
    // Uma cápsula flutuante, com o vidro e a sombra do cabeçalho; o `nav` de
    // fora não apanha cliques (só a cápsula), para não tapar a página dos lados.
    <nav
      ref={bar}
      aria-label="Categorias"
      className={`pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:hidden pr-[5.25rem]`}
    >
      <ul className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-white/[0.08] bg-ink-soft/75 p-1 shadow-lg shadow-black/30 backdrop-blur-xl">
        {items.map((c) => {
          const active = pathname === c.href || pathname.startsWith(`${c.href}/`);
          return (
            <li key={c.href}>
              <Link
                href={c.href}
                aria-current={active ? "page" : undefined}
                className={`relative block rounded-full ${compact ? "px-2.5 py-2 text-[0.75rem]" : "px-4 py-2 text-[0.8rem]"} font-semibold transition-colors duration-300 ${
                  active ? "text-ink" : "text-paper/70 active:text-paper"
                }`}
              >
                {/* O destaque desliza de uma categoria para a outra. */}
                {active && (
                  <motion.span
                    layoutId="core3-mobile-nav"
                    transition={{ type: "spring", stiffness: 420, damping: 36 }}
                    className="absolute inset-0 rounded-full bg-accent"
                  />
                )}
                <span className="relative">{c.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
