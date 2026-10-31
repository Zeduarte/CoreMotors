"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions/auth";
import { Avatar } from "./Avatar";
import { ThemeToggle } from "./ThemeToggle";
import { ADMIN_NAV, isAdminNavActive } from "./admin-nav";
import type { Section } from "@/lib/permissions";

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
  const items = ADMIN_NAV.filter((i) => sections.includes(i.section));

  return (
    // Em modo app (iPhone, `viewport-fit=cover`) a barra estende o fundo por
    // baixo da barra de estado e do notch; o conteúdo fica abaixo dela. Só em
    // mobile — e sem invólucro à volta, senão o `sticky` não acompanha a página.
    <header className="sticky top-0 z-40 border-b md:hidden border-white/10 bg-black/70 pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur-xl">
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
        <nav className="max-h-[calc(100dvh-4.5rem)] overflow-y-auto overscroll-contain border-t border-white/10 px-2 py-2">
          {items.map((item) => {
            const active = isAdminNavActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm ${
                  active ? "bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-accent" : "text-paper/80"
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
          <div className="mt-2 border-t border-white/10 px-3 pt-3">
            <ThemeToggle />
          </div>
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
