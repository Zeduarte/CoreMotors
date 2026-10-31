"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Section } from "@/lib/permissions";
import { AdminIcon } from "./AdminIcon";
import { ADMIN_NAV, isAdminNavActive } from "./admin-nav";

/** Os atalhos de todos os dias; o resto está na barra lateral. */
const DOCK = ["/admin", "/admin/carros", "/admin/leads", "/admin/leads/agenda", "/admin/oficina"];

/**
 * Pílula de atalhos, flutuante e centrada em baixo: texto nos separadores, o
 * ativo em branco, e um «+» para criar uma viatura.
 */
export function AdminDock({ sections }: { sections: Section[] }) {
  const pathname = usePathname();
  const tabs = DOCK.map((href) => ADMIN_NAV.find((i) => i.href === href)).filter(
    (i): i is (typeof ADMIN_NAV)[number] => !!i && sections.includes(i.section),
  );
  const create = sections.includes("carros");

  return (
    <nav
      aria-label="Atalhos"
      className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-black/70 p-1.5 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl"
    >
      {tabs.map((item) => {
        const active = isAdminNavActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-4 py-2 text-sm transition-colors ${
              active ? "bg-paper font-semibold text-ink" : "text-paper/65 hover:bg-white/10 hover:text-paper"
            }`}
          >
            {item.label.replace("Agenda de visitas", "Agenda")}
          </Link>
        );
      })}
      {create && (
        <Link
          href="/admin/carros/novo"
          aria-label="Nova viatura"
          className="ml-1 grid h-9 w-9 place-items-center rounded-full bg-paper text-ink transition-transform hover:scale-105"
        >
          <AdminIcon name="plus" size={18} />
        </Link>
      )}
    </nav>
  );
}
