"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import type { VehicleType } from "@/lib/vehicle-categories";
import { adminPathHasWorld, otherWorld } from "@/lib/world";

const NAME: Record<VehicleType, string> = { car: "Carros", motorcycle: "Motas" };
const WORLDS: VehicleType[] = ["car", "motorcycle"];

/**
 * Faixa grande no topo de cada ecrã do backoffice: diz em que mundo se está
 * (o nome em letras grandes, sobre a foto desse mundo) e tem os dois
 * separadores Carros | Motas. Se o outro mundo tiver contactos novos, o seu
 * separador acende-se com o número, para o utilizador saber que deve mudar.
 *
 * Nos ecrãs comuns ao site inteiro (testemunhos, utilizadores, definições…)
 * mostra só uma faixa «Todo o site», para não parecer que dependem do mundo.
 */
export function AdminWorldBanner({
  world,
  allowed,
  newByWorld,
  images,
}: {
  world: VehicleType;
  allowed: VehicleType[];
  newByWorld: Record<VehicleType, number>;
  images: Record<VehicleType, string>;
}) {
  const pathname = usePathname();
  const section = pathname.split("/")[2] ?? "";
  if (section === "perfil") return null;

  if (!adminPathHasWorld(pathname)) {
    return (
      <div className="mb-6 flex items-center justify-between gap-4 rounded-[2rem] border border-white/10 bg-gradient-to-r from-[color-mix(in_srgb,var(--accent)_20%,transparent)] via-white/[0.04] to-transparent px-6 py-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">Comum</p>
          <p className="text-2xl font-extrabold tracking-tight text-paper md:text-3xl">Todo o site</p>
        </div>
        <p className="hidden max-w-xs text-right text-xs text-paper/50 sm:block">
          Esta secção vale para carros e motas: não depende do tipo de viatura.
        </p>
      </div>
    );
  }

  const other = otherWorld(world);
  const target = encodeURIComponent(adminTarget(pathname));
  const pendingOther = allowed.includes(other) ? newByWorld[other] : 0;

  return (
    <section
      aria-label={`A gerir ${NAME[world]}`}
      className="relative mb-6 overflow-hidden rounded-[2rem] border border-white/10 bg-ink-soft"
    >
      <Image src={images[world]} alt="" fill priority sizes="(max-width: 1280px) 100vw, 1100px" className="object-cover object-center opacity-70" />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-ink from-25% via-ink/70 via-55% to-ink/10" />
      <div className="relative flex flex-col gap-5 p-5 md:min-h-[9.5rem] md:flex-row md:items-center md:justify-between md:p-7">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-accent">A gerir</p>
          <p className="text-5xl font-extrabold uppercase leading-none tracking-tight text-paper md:text-6xl">{NAME[world]}</p>
        </div>

        <div className="flex flex-col items-start gap-2 md:items-end">
          <nav aria-label="Carros ou motas" className="flex gap-1 rounded-full border border-white/10 bg-black/40 p-1 backdrop-blur-md">
            {WORLDS.map((w) => {
              const active = w === world;
              const count = allowed.includes(w) ? newByWorld[w] : 0;
              const base = "flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-colors";
              if (active) {
                return (
                  <span key={w} aria-current="page" className={`${base} bg-paper text-ink`}>
                    {NAME[w]}
                    {count > 0 && <Count n={count} dark />}
                  </span>
                );
              }
              if (!allowed.includes(w)) {
                return (
                  <span key={w} aria-disabled="true" className={`${base} cursor-not-allowed text-paper/30`}>
                    {NAME[w]}
                  </span>
                );
              }
              return (
                <a
                  key={w}
                  // Rota dentro de /admin: na app instalada a troca não sai da app.
                  href={`/admin/vehicle-context?type=${w}&target=${target}`}
                  className={`${base} text-paper/75 hover:bg-white/10 hover:text-paper`}
                >
                  {NAME[w]}
                  {count > 0 && <Count n={count} />}
                </a>
              );
            })}
          </nav>
          {pendingOther > 0 && (
            <a
              // Leva aos contactos novos do outro mundo, esteja-se em que ecrã
              // for (nos Custos, por exemplo, ficar na mesma página não mostrava nada).
              href={`/admin/vehicle-context?type=${other}&target=${encodeURIComponent("/admin/leads")}`}
              className="inline-flex items-center gap-2 rounded-full bg-accent px-3.5 py-1.5 text-xs font-semibold text-ink shadow-[0_8px_24px_-10px_var(--accent)] transition-transform hover:scale-[1.03]"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ink/60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-ink" />
              </span>
              {pendingOther} {pendingOther === 1 ? "contacto novo" : "contactos novos"} em {NAME[other].toLowerCase()} — ver
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

function Count({ n, dark = false }: { n: number; dark?: boolean }) {
  return (
    <span
      className={`grid min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold leading-5 ${
        dark ? "bg-ink text-paper" : "bg-accent text-ink"
      }`}
    >
      {n}
    </span>
  );
}

/**
 * Ao trocar de mundo, um id de viatura deixa de existir — volta-se à lista da
 * mesma secção em vez de abrir uma página vazia.
 */
function adminTarget(pathname: string): string {
  const section = pathname.split("/")[2];
  if (pathname === "/admin/carros/novo" || pathname === "/admin/leads/agenda") return pathname;
  return section ? `/admin/${section}` : "/admin";
}
