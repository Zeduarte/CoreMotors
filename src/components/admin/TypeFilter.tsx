import Link from "next/link";
import type { VehicleType } from "@/lib/vehicle-categories";

/**
 * O backoffice é um só para carros e motas. Onde ajuda separar, há este
 * seletor simples — «Todos · Carros · Motas» — em vez de dois ambientes.
 *
 * - Com `hrefFor`, cada opção é um link (páginas do servidor, `?tipo=`).
 * - Com `onSelect`, cada opção é um botão (listas filtradas no browser).
 *
 * Quem só tem acesso a um tipo não vê o seletor: não há nada a escolher.
 */
export type TypeChoice = "todos" | "carros" | "motas";

const OPTIONS: { value: TypeChoice; label: string; type?: VehicleType }[] = [
  { value: "todos", label: "Todos" },
  { value: "carros", label: "Carros", type: "car" },
  { value: "motas", label: "Motas", type: "motorcycle" },
];

export function typeChoice(raw: string | null | undefined): TypeChoice {
  return raw === "carros" || raw === "motas" ? raw : "todos";
}

export function TypeFilter({
  value,
  allowed,
  counts,
  hrefFor,
  onSelect,
  className = "",
}: {
  value: TypeChoice;
  allowed: VehicleType[];
  counts?: Partial<Record<TypeChoice, number>>;
  hrefFor?: (choice: TypeChoice) => string;
  onSelect?: (choice: TypeChoice) => void;
  className?: string;
}) {
  if (allowed.length < 2) return null;
  return (
    <nav
      aria-label="Tipo de viatura"
      className={`inline-flex gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1 ${className}`}
    >
      {OPTIONS.map((o) => {
        const active = o.value === value;
        const n = counts?.[o.value];
        const cls = `flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
          active ? "bg-paper text-ink shadow" : "text-paper/65 hover:bg-white/10 hover:text-paper"
        }`;
        const body = (
          <>
            {o.label}
            {n !== undefined && (
              <span className={`text-xs tabular-nums ${active ? "text-ink/60" : "text-paper/40"}`}>{n}</span>
            )}
          </>
        );
        return hrefFor ? (
          <Link key={o.value} href={hrefFor(o.value)} aria-current={active ? "page" : undefined} className={cls}>
            {body}
          </Link>
        ) : (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect?.(o.value)}
            className={cls}
          >
            {body}
          </button>
        );
      })}
    </nav>
  );
}

/** Pequena etiqueta para distinguir motas de carros numa lista mista. */
export function TypeTag({ type }: { type: VehicleType | null | undefined }) {
  if (!type) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
        type === "motorcycle" ? "bg-sky-500/15 text-sky-300" : "bg-white/[0.06] text-paper/55"
      }`}
    >
      {type === "motorcycle" ? "Mota" : "Carro"}
    </span>
  );
}

/** Junta `?tipo=` a um endereço, mantendo os outros parâmetros. */
export function withTipo(
  path: string,
  params: Record<string, string | undefined>,
  choice: TypeChoice,
): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v && k !== "tipo" && k !== "page") p.set(k, v);
  if (choice !== "todos") p.set("tipo", choice);
  const q = p.toString();
  return q ? `${path}?${q}` : path;
}
