"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { logout } from "@/lib/actions/auth";
import type { Section } from "@/lib/permissions";
import { AdminIcon } from "./AdminIcon";
import { ADMIN_NAV, isAdminNavActive } from "./admin-nav";

const ITEM =
  "relative flex min-h-12 w-full shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-1.5 transition-colors";
const LABEL = "max-w-full truncate text-[9.5px] font-medium leading-tight";

/**
 * Barra lateral de vidro, arredondada, à esquerda: ícone com o nome curto por
 * baixo, para ninguém se perder. O separador ativo fica em branco (ou escuro,
 * no tema claro). Se o ecrã for baixo, a lista faz scroll — e, como a barra
 * de scroll está escondida, as pontas esbatem-se e aparece uma seta a indicar
 * que há mais separadores (clicar na seta desliza a lista).
 */
export function Sidebar({
  sections,
  newLeads = 0,
}: {
  sections: Section[];
  newLeads?: number;
}) {
  const pathname = usePathname();
  const items = ADMIN_NAV.filter((i) => sections.includes(i.section));
  const navRef = useRef<HTMLElement>(null);
  const [more, setMore] = useState({ up: false, down: false });

  const measure = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    const up = el.scrollTop > 2;
    const down = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    setMore((m) => (m.up === up && m.down === down ? m : { up, down }));
  }, []);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, items.length]);

  // O separador ativo fica sempre à vista, ao centro (ex.: Definições, no fim
  // da lista), em vez de cortado debaixo do esbatido.
  useEffect(() => {
    const el = navRef.current;
    const active = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el && active) {
      const n = el.getBoundingClientRect();
      const a = active.getBoundingClientRect();
      if (a.top < n.top || a.bottom > n.bottom) {
        el.scrollTop += a.top - n.top - (n.height - a.height) / 2;
      }
    }
    measure();
  }, [pathname, measure]);

  const scrollBy = (dir: 1 | -1) => {
    const el = navRef.current;
    if (!el) return;
    el.scrollBy({ top: dir * Math.max(120, el.clientHeight * 0.6), behavior: "smooth" });
  };

  const FADE = "28px";
  const mask = `linear-gradient(to bottom, ${more.up ? "transparent" : "#000"} 0, #000 ${
    more.up ? FADE : "0px"
  }, #000 calc(100% - ${more.down ? FADE : "0px"}), ${more.down ? "transparent" : "#000"} 100%)`;

  return (
    <aside className="flex h-full w-[80px] flex-col items-center gap-1 rounded-[2rem] border border-white/10 bg-white/[0.04] px-2 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_30px_60px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl">
      <div className="relative flex min-h-0 w-full flex-1 flex-col">
        <nav
          ref={navRef}
          onScroll={measure}
          aria-label="Backoffice"
          style={{ maskImage: mask, WebkitMaskImage: mask }}
          className="flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {items.map((item) => {
            const active = isAdminNavActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={`${ITEM} ${
                  active ? "bg-paper text-ink shadow-md" : "text-paper/60 hover:bg-white/10 hover:text-paper"
                }`}
              >
                <AdminIcon name={item.icon} />
                <span className={LABEL}>{item.short}</span>
                {item.href === "/admin/leads" && newLeads > 0 && (
                  <span className="absolute right-1.5 top-1 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-bold leading-4 text-ink">
                    {newLeads}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <ScrollHint dir="up" show={more.up} onClick={() => scrollBy(-1)} />
        <ScrollHint dir="down" show={more.down} onClick={() => scrollBy(1)} />
      </div>

      <div className="flex w-full flex-col items-center gap-0.5 border-t border-white/10 pt-2">
        <Link
          href="/"
          target="_blank"
          aria-label="Ver site público"
          className={`${ITEM} text-paper/60 hover:bg-white/10 hover:text-paper`}
        >
          <AdminIcon name="external" />
          <span className={LABEL}>Site</span>
        </Link>
        <form action={logout} className="w-full">
          <button
            type="submit"
            aria-label="Terminar sessão"
            className={`${ITEM} text-paper/60 hover:bg-red-500/15 hover:text-red-300`}
          >
            <AdminIcon name="logout" />
            <span className={LABEL}>Sair</span>
          </button>
        </form>
      </div>
    </aside>
  );
}

function ScrollHint({
  dir,
  show,
  onClick,
}: {
  dir: "up" | "down";
  show: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      onClick={onClick}
      className={`absolute left-1/2 z-10 grid h-6 w-10 -translate-x-1/2 place-items-center rounded-full bg-accent text-ink shadow-[0_4px_14px_-2px_rgba(0,0,0,0.7)] ring-2 ring-ink/60 transition-all duration-200 hover:brightness-110 ${
        dir === "up" ? "-top-1" : "-bottom-1"
      } ${show ? "opacity-100" : "pointer-events-none opacity-0"}`}
    >
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={dir === "up" ? "rotate-180" : undefined}
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
}
