import Link from "next/link";
import { Avatar } from "./Avatar";
import { AdminIcon } from "./AdminIcon";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Faixa de vidro no topo: quem está a trabalhar à esquerda, o stand ao centro,
 * e à direita o tema e os contactos novos.
 */
export function AdminTopBar({
  user,
  companyName,
  newLeads = 0,
}: {
  user: { name: string };
  companyName: string;
  newLeads?: number;
}) {
  const first = user.name.split(/[\s@]/)[0] ?? user.name;
  return (
    <header className="flex h-14 items-center justify-between gap-4 rounded-full border border-white/10 bg-white/[0.04] pl-2 pr-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_20px_40px_-26px_rgba(0,0,0,0.9)] backdrop-blur-xl">
      <Link href="/admin/perfil" className="flex min-w-0 items-center gap-3 rounded-full pr-3 transition-colors hover:bg-white/5">
        <Avatar name={user.name} size={40} />
        <span className="truncate text-sm font-medium text-paper">Bem-vindo, {first}</span>
      </Link>

      <Link href="/admin" className="hidden truncate text-sm font-semibold tracking-tight text-paper/80 lg:block">
        {companyName}
        <span className="ml-2 rounded-full bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
          Admin
        </span>
      </Link>

      <div className="flex items-center gap-2">
        <div className="hidden w-[132px] sm:block">
          <ThemeToggle compact />
        </div>
        <Link
          href="/admin/leads"
          aria-label={newLeads > 0 ? `${newLeads} contactos novos` : "Contactos"}
          className="relative grid h-10 w-10 place-items-center rounded-full bg-paper text-ink transition-transform hover:scale-105"
        >
          <AdminIcon name="bell" size={18} />
          {newLeads > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-paper" />}
        </Link>
      </div>
    </header>
  );
}
