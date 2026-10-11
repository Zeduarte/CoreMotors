import { groupExtras } from "@/lib/extras";

/**
 * Extras/equipamento agrupados por categoria, cada categoria num cartão com
 * itens marcados por um "check" vermelho, em duas colunas (estilo portais).
 * Não renderiza nada se a viatura não tiver extras.
 */
export function ExtrasGroups({
  extras,
  className = "space-y-5",
}: {
  extras?: string[];
  className?: string;
}) {
  const groups = groupExtras(extras);
  if (groups.length === 0) return null;

  return (
    <div className={className}>
      {groups.map((g) => (
        <section
          key={g.title}
          className="rounded-3xl bg-ink-soft p-6 md:p-8"
          aria-labelledby={`extras-${g.title}`}
        >
          <h3
            id={`extras-${g.title}`}
            className="text-xl font-semibold text-paper"
          >
            {g.title}
          </h3>
          <ul className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            {g.items.map((item) => (
              <li key={item} className="flex items-start gap-3 text-paper/85">
                <span
                  aria-hidden
                  className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-ink"
                >
                  ✓
                </span>
                <span className="text-[15px] leading-snug">{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
