"use client";

import { usePathname } from "next/navigation";
import type { VehicleType } from "@/lib/vehicle-categories";
import { WORLD_LABEL, adminPathHasWorld, otherWorld } from "@/lib/world";

/**
 * Faixa do backoffice que diz em que mundo se está a trabalhar e deixa passar
 * para o outro.
 *
 * Não aparece em Testemunhos, Utilizadores, Definições e Integrações — são
 * transversais ao site — nem a quem só tem acesso a um tipo de viatura.
 */
export function AdminWorldBar({
  world,
  allowed,
}: {
  world: VehicleType;
  allowed: VehicleType[];
}) {
  const pathname = usePathname();
  if (!adminPathHasWorld(pathname)) return null;

  const target = otherWorld(world);
  const canSwitch = allowed.includes(target);

  return (
    <div className="mb-6 flex items-center justify-between gap-4 border-b border-white/10 pb-3">
      <p className="text-sm text-paper/60">
        A gerir <span className="font-medium text-paper">{WORLD_LABEL[world]}</span>
      </p>
      {canSwitch && (
        <a
          // Rota dentro de /admin: na app instalada a troca não sai da app.
          href={`/admin/vehicle-context?type=${target}&target=${encodeURIComponent(adminTarget(pathname))}`}
          className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-paper/70 transition-colors hover:border-accent hover:text-accent"
        >
          Passar para {WORLD_LABEL[target]}
        </a>
      )}
    </div>
  );
}

/**
 * Ao trocar de mundo, um id de viatura deixa de existir — volta-se à lista da
 * mesma secção em vez de abrir uma página vazia.
 */
function adminTarget(pathname: string): string {
  const section = pathname.split("/")[2];
  if (pathname === "/admin/carros/novo") return pathname;
  return section ? `/admin/${section}` : "/admin";
}
