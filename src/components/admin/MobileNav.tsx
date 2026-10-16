"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions/auth";
import { Avatar } from "./Avatar";
import type { Section } from "@/lib/permissions";

const NAV: { href: string; label: string; exact: boolean; section: Section }[] = [
  { href: "/admin", label: "Dashboard", exact: true, section: "dashboard" },
  { href: "/admin/carros", label: "Viaturas", exact: false, section: "carros" },
  { href: "/admin/carros/novo", label: "Nova viatura", exact: true, section: "carros" },
  { href: "/admin/pagina-inicial", label: "Página inicial", exact: false, section: "pagina-inicial" },
  { href: "/admin/leads", label: "Leads", exact: false, section: "leads" },
  { href: "/admin/leads/agenda", label: "Agenda de visitas", exact: false, section: "leads" },
  { href: "/admin/testemunhos", label: "Testemunhos", exact: false, section: "testemunhos" },
  { href: "/admin/integracoes", label: "Integrações", exact: false, section: "integracoes" },
  { href: "/admin/anuncios", label: "Plataformas de anúncios", exact: false, section: "anuncios" },
  { href: "/admin/utilizadores", label: "Utilizadores", exact: false, section: "utilizadores" },
  { href: "/admin/definicoes", label: "Definições", exact: false, section: "definicoes" },
  { href: "/admin/financeiro", label: "Custos e margens", exact: false, section: "financeiro" },
  { href: "/admin/oficina", label: "Oficina", exact: false, section: "oficina" },
  { href: "/admin/horas", label: "Horas", exact: false, section: "horas" },
];

export function MobileNav({
  user,
  sections,
  companyName = "Supermotas",
  newLeads = 0,
}: {
  user: { name: string; role: string };
  sections: Section[];
  companyName?: string;
  newLeads?: number;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const items = NAV.filter((i) => sections.includes(i.section));

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-ink-soft/95 backdrop-blur">
      <div className="flex items-center justify-between px-4 py-3">
        <Link href="/admin" className="text-base font-bold tracking-tight">
          <span className="text-paper">{companyName}</span>
          <span className="ml-1 text-xs text-paper/50">Admin</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Menu"
          className="rounded-lg border border-white/15 px-3 py-1.5 text-sm"
        >
          {open ? "✕" : "☰"}
        </button>
      </div>

      {open && (
        <nav className="border-t border-white/10 px-2 py-2">
          {items.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href) &&
                !(item.href === "/admin/leads" && pathname.startsWith("/admin/leads/agenda"));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm ${
                  active ? "bg-accent/15 text-accent" : "text-paper/80"
                }`}
              >
                {item.label}
                {item.href === "/admin/leads" && newLeads > 0 && (
                  <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-ink">
                    {newLeads}
                  </span>
                )}
              </Link>
            );
          })}
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-white/10 px-3 pt-3">
            {/* Avatar: entrada para a área pessoal, como na barra lateral. */}
            <Link href="/admin/perfil" className="flex min-w-0 items-center gap-2">
              <Avatar name={user.name} size={28} />
              <span className="truncate text-xs text-paper/70">{user.name}</span>
            </Link>
            <form action={logout}>
              <button type="submit" className="text-xs text-paper/60">
                Terminar sessão
              </button>
            </form>
          </div>
        </nav>
      )}
    </header>
  );
}
