"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { logout } from "@/lib/actions/auth";
import type { Section } from "@/lib/permissions";
import { AdminIcon } from "./AdminIcon";
import { ADMIN_NAV, ADMIN_NAV_GROUPS, canSeeNavItem, isAdminNavActive, type AdminNavItem } from "./admin-nav";

// Em ecrãs baixos (portáteis de 720–768 px) os itens encolhem e, abaixo de
// ~620 px, ficam só os ícones: assim a barra cabe sempre, sem scroll.
const ITEM =
  "relative flex min-h-12 w-full shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-1.5 transition-colors [@media(min-height:621px)_and_(max-height:780px)]:min-h-10 [@media(min-height:621px)_and_(max-height:780px)]:py-1 [@media(max-height:620px)]:min-h-8 [@media(max-height:620px)]:py-0.5";
const LABEL = "max-w-full truncate text-[9.5px] font-medium leading-tight [@media(max-height:620px)]:hidden";
const IDLE = "text-paper/60 hover:bg-white/10 hover:text-paper";
const ACTIVE = "bg-paper text-ink shadow-md";

/** Tempo para o rato atravessar do ícone para o painel sem ele fechar. */
const CLOSE_DELAY = 180;

/**
 * Barra lateral de vidro, arredondada, à esquerda: ícone com o nome curto por
 * baixo. Os separadores estão agrupados (`ADMIN_NAV_GROUPS`) para caberem
 * todos sem scroll: um grupo com vários separadores abre um painel ao lado ao
 * passar o rato ou ao clicar (no tátil, só ao tocar). O grupo da página
 * aberta fica em branco (ou escuro, no tema claro).
 */
export function Sidebar({
  sections,
  newLeads = 0,
}: {
  sections: Section[];
  newLeads?: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Como foi o último toque/clique (o `click` do Safari antigo não o diz).
  const lastPointer = useRef("");
  const asideRef = useRef<HTMLElement>(null);

  const groups = ADMIN_NAV_GROUPS.map((g) => ({
    ...g,
    items: g.hrefs
      .map((href) => ADMIN_NAV.find((i) => i.href === href))
      .filter((i): i is AdminNavItem => !!i && canSeeNavItem(i, sections)),
  })).filter((g) => g.items.length > 0);

  const cancelClose = () => clearTimeout(closeTimer.current);
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(null), CLOSE_DELAY);
  };

  // Fecha ao mudar de página, com Esc e ao clicar fora.
  useEffect(() => {
    setOpen(null);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    const onDown = (e: PointerEvent) => {
      if (!asideRef.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const badge = (item: AdminNavItem) => (item.href === "/admin/leads" ? newLeads : 0);

  return (
    <aside
      ref={asideRef}
      className="flex h-full w-[80px] flex-col items-center gap-1 rounded-[2rem] border border-white/10 bg-white/[0.04] px-2 py-3 [@media(max-height:780px)]:py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_30px_60px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl"
    >
      <nav aria-label="Backoffice" className="flex w-full flex-1 flex-col items-center gap-0.5">
        {groups.map((group) => {
          const active = group.items.some((i) => isAdminNavActive(pathname, i));
          const count = group.items.reduce((n, i) => n + badge(i), 0);

          // Um só separador: link direto. Se o grupo tem outros que este
          // utilizador não vê (ex.: o mecânico só tem a Oficina do grupo
          // Viaturas), mostra o nome e o ícone do próprio separador.
          if (group.items.length === 1) {
            const item = group.items[0]!;
            const own = group.hrefs.length > 1;
            return (
              <Link
                key={group.key}
                href={item.href}
                aria-label={
                  own || group.short === item.label ? item.label : `${group.short}: ${item.label}`
                }
                aria-current={active ? "page" : undefined}
                className={`${ITEM} ${active ? ACTIVE : IDLE}`}
              >
                <AdminIcon name={own ? item.icon : group.icon} />
                <span className={LABEL}>{own ? item.short : group.short}</span>
                <Badge count={count} />
              </Link>
            );
          }

          const isOpen = open === group.key;
          return (
            <div
              key={group.key}
              className="relative w-full"
              onPointerEnter={(e) => {
                if (e.pointerType !== "mouse") return;
                cancelClose();
                setOpen(group.key);
              }}
              onPointerLeave={(e) => e.pointerType === "mouse" && closeSoon()}
            >
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={isOpen}
                aria-label={group.short === group.label ? group.label : `${group.short}: ${group.label}`}
                onPointerDown={(e) => (lastPointer.current = e.pointerType)}
                onKeyDown={() => (lastPointer.current = "")}
                onClick={() => {
                  // Com rato o painel já abriu ao passar por cima: o clique deixa-o aberto.
                  const mouse = lastPointer.current === "mouse";
                  setOpen((cur) => (cur === group.key && !mouse ? null : group.key));
                }}
                className={`${ITEM} ${active ? ACTIVE : isOpen ? "bg-white/10 text-paper" : IDLE}`}
              >
                {/* Seta pequena ao lado do ícone (longe do nome): abre mais opções. */}
                <span className="relative">
                  <AdminIcon name={group.icon} />
                  <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  width="9"
                  height="9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="absolute left-full top-1/2 ml-0.5 -translate-y-1/2 opacity-50"
                >
                  <path d="m9 6 6 6-6 6" />
                </svg>
                </span>
                <span className={LABEL}>{group.short}</span>
                <Badge count={count} />
              </button>

              {isOpen && (
                // `pl-3` em vez de margem: o rato atravessa o espaço sem sair do grupo.
                <div className="absolute left-full top-0 z-40 pl-3">
                  <div
                    role="menu"
                    aria-label={group.label}
                    className="min-w-[13rem] rounded-2xl border border-white/10 bg-ink-muted p-1.5 shadow-[0_24px_48px_-16px_rgba(0,0,0,0.75)] backdrop-blur-xl"
                  >
                    <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-paper/45">
                      {group.label}
                    </p>
                    {group.items.map((item) => {
                      const on = isAdminNavActive(pathname, item);
                      const n = badge(item);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          role="menuitem"
                          aria-current={on ? "page" : undefined}
                          onClick={() => setOpen(null)}
                          className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
                            on ? ACTIVE : "text-paper/75 hover:bg-white/10 hover:text-paper"
                          }`}
                        >
                          <AdminIcon name={item.icon} />
                          <span className="flex-1 whitespace-nowrap">{item.label}</span>
                          {n > 0 && (
                            <span className="grid min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[10px] font-bold leading-5 text-ink">
                              {n}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="flex w-full flex-col items-center gap-0.5 border-t border-white/10 pt-2">
        <Link href="/" target="_blank" aria-label="Ver site público" className={`${ITEM} ${IDLE}`}>
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

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute right-1.5 top-1 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-bold leading-4 text-ink">
      {count}
    </span>
  );
}
