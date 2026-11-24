import Link from "next/link";
import type { ShowroomContent } from "@/lib/showroom";
import { SERVICE_PERKS, STATIC_PERKS } from "@/themes/core3/ui";
import { Core3Icon, type Core3IconName } from "./icons";

/**
 * A faixa de serviços da página inicial (os serviços já não têm menu): retomas
 * e entregas (fixas) e o financiamento e a garantia, que vêm dos serviços do
 * backoffice (Serviços) e só aparecem se estiverem ativos; cada um leva à sua
 * página. Por baixo, a ligação ao questionário «Veículo ideal».
 */
export function Core3Services({ services }: { services: ShowroomContent["services"] }) {
  const perks: { id: string; icon: Core3IconName; title: string; text: string; href?: string }[] = [
    ...STATIC_PERKS.map((p) => ({ ...p })),
    ...services
      .filter((s) => s.enabled && s.id in SERVICE_PERKS)
      .map((s) => ({ id: s.id, icon: SERVICE_PERKS[s.id]!, title: s.title, text: s.summary, href: `/servicos/${s.id}` })),
  ];

  return (
    <section className="container-px mt-10 md:mt-12" aria-label="Serviços">
      <ul className="grid divide-white/10 overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] sm:grid-cols-2 sm:divide-x lg:grid-cols-4">
        {perks.map((p) => {
          const body = (
            <>
              <Core3Icon name={p.icon} className="h-8 w-8 shrink-0 text-accent" />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-paper">{p.title}</span>
                <span className="mt-0.5 block text-xs leading-snug text-paper/60">{p.text}</span>
              </span>
            </>
          );
          return (
            <li key={p.id} className="border-b border-white/10 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 lg:border-b-0">
              {p.href ? (
                <Link href={p.href} className="flex items-center gap-3.5 px-5 py-4 transition-colors hover:bg-white/5">
                  {body}
                </Link>
              ) : (
                <div className="flex items-center gap-3.5 px-5 py-4">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-center text-sm text-paper/65">
        Não sabe qual escolher?{" "}
        <Link href="/quiz" className="font-semibold text-accent hover:underline">
          Descubra o veículo ideal →
        </Link>
      </p>
    </section>
  );
}
