"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
 * no tema claro). Se o ecrã for baixo, a lista faz scroll.
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

  return (
    <aside className="flex h-full w-[80px] flex-col items-center gap-1 rounded-[2rem] border border-white/10 bg-white/[0.04] px-2 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_30px_60px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl">
      <nav aria-label="Backoffice" className="flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto [scrollbar-width:none]">
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
