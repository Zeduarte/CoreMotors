"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions/auth";
import type { Section } from "@/lib/permissions";
import { Avatar } from "./Avatar";

const NAV: {
  href: string;
  label: string;
  icon: string;
  exact: boolean;
  section: Section;
}[] = [
  { href: "/admin", label: "Dashboard", icon: "▨", exact: true, section: "dashboard" },
  { href: "/admin/carros", label: "Viaturas", icon: "▦", exact: false, section: "carros" },
  { href: "/admin/carros/novo", label: "Nova viatura", icon: "＋", exact: true, section: "carros" },
  { href: "/admin/pagina-inicial", label: "Página inicial", icon: "◧", exact: false, section: "pagina-inicial" },
  { href: "/admin/leads", label: "Leads", icon: "✉", exact: false, section: "leads" },
  { href: "/admin/leads/agenda", label: "Agenda de visitas", icon: "▣", exact: false, section: "leads" },
  { href: "/admin/testemunhos", label: "Testemunhos", icon: "★", exact: false, section: "testemunhos" },
  { href: "/admin/integracoes", label: "Integrações", icon: "⇄", exact: false, section: "integracoes" },
  { href: "/admin/anuncios", label: "Plataformas de anúncios", icon: "⊞", exact: false, section: "anuncios" },
  { href: "/admin/utilizadores", label: "Utilizadores", icon: "◑", exact: false, section: "utilizadores" },
  { href: "/admin/definicoes", label: "Definições", icon: "⚙", exact: false, section: "definicoes" },
  { href: "/admin/financeiro", label: "Custos e margens", icon: "€", exact: false, section: "financeiro" },
  { href: "/admin/oficina", label: "Oficina", icon: "⚒", exact: false, section: "oficina" },
  { href: "/admin/horas", label: "Horas", icon: "◷", exact: false, section: "horas" },
];

export function Sidebar({
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
  const pathname = usePathname();
  const items = NAV.filter((i) => sections.includes(i.section));

  const isActive = (href: string, exact: boolean) =>
    exact
      ? pathname === href
      : pathname.startsWith(href) && !(href === "/admin/leads" && pathname.startsWith("/admin/leads/agenda"));

  return (
    <aside className="flex h-full flex-col gap-6 border-r border-white/10 bg-ink-soft p-5">
      <Link href="/admin" className="flex items-center gap-2 px-2">
        <span className="truncate text-lg font-bold tracking-tight text-paper">
          {companyName}
        </span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-paper/60">
          Admin
        </span>
      </Link>

      {/* A área pessoal fica destacada no topo, separada dos separadores de
          trabalho: é aqui que cada um trata dos seus dados e das suas férias,
          e no rodapé passava despercebida. */}
      <Link
        href="/admin/perfil"
        aria-current={pathname.startsWith("/admin/perfil") ? "page" : undefined}
        className={`flex items-center gap-3 rounded-xl border p-3 transition-colors ${
          pathname.startsWith("/admin/perfil")
            ? "border-accent/40 bg-accent/15"
            : "border-white/10 hover:border-white/25 hover:bg-white/5"
        }`}
      >
        <Avatar name={user.name} size={40} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-paper">
            {user.name}
          </span>
          <span className="block text-xs text-paper/50">
            O meu perfil e férias
          </span>
        </span>
      </Link>

      <nav className="flex flex-1 flex-col gap-1">
        {items.map((item) => {
          const active = isActive(item.href, item.exact);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                active
                  ? "bg-accent/15 font-medium text-accent"
                  : "text-paper/70 hover:bg-white/5 hover:text-paper"
              }`}
            >
              <span className="flex items-center gap-3">
                <span aria-hidden className="w-4 text-center">
                  {item.icon}
                </span>
                {item.label}
              </span>
              {item.href === "/admin/leads" && newLeads > 0 && (
                <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-ink">
                  {newLeads}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 pt-4">
        <Link
          href="/"
          target="_blank"
          className="mb-1 block rounded-lg px-2 py-2 text-xs text-paper/60 transition-colors hover:text-paper"
        >
          ↗ Ver site público
        </Link>
        <form action={logout}>
          <button
            type="submit"
            className="w-full rounded-lg px-2 py-2 text-left text-xs text-paper/60 transition-colors hover:text-red-300"
          >
            ⏻ Terminar sessão
          </button>
        </form>
      </div>
    </aside>
  );
}
