import Image from "next/image";
import Link from "next/link";

/**
 * O topo das páginas do Core3 (maquetes): o título com o traço de destaque e a
 * frase à esquerda, e a foto à direita a desvanecer para o título (no
 * telemóvel, por cima dele). As páginas de stock levam o caminho por cima do
 * título («Início › Carros › Automóveis em stock»).
 */
export function Core3Banner({
  photo,
  title,
  subtitle,
  big = false,
  crumbs,
  mobilePosition = "object-left",
}: {
  photo: string;
  title: string;
  subtitle: string;
  /** Título grande e foto alta (a página inicial). */
  big?: boolean;
  /** O caminho por cima do título; o último não é ligação. */
  crumbs?: { label: string; href?: string }[];
  /** Que parte da foto se vê no telemóvel (classe do Tailwind); no computador, sempre a esquerda. */
  mobilePosition?: string;
}) {
  return (
    <section className="relative overflow-hidden text-paper">
      <div aria-hidden className="relative aspect-[5/2] md:absolute md:inset-y-0 md:right-0 md:aspect-auto md:w-[68%]">
        <Image src={photo} alt="" fill priority sizes="(max-width: 768px) 100vw, 68vw" className={`object-cover ${mobilePosition} md:object-left`} />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent from-45% to-ink md:hidden" />
        <div className="absolute inset-0 hidden bg-gradient-to-r from-ink from-[6%] via-ink/45 via-[20%] to-transparent to-[42%] md:block" />
      </div>
      <div className={`container-px relative -mt-9 pb-4 md:mt-0 md:flex md:flex-col md:justify-center md:py-10 ${big ? "md:min-h-[22rem]" : "md:min-h-[12.5rem]"}`}>
        {crumbs && (
          <nav aria-label="Caminho" className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-paper/60">
            {crumbs.map((c, i) => (
              <span key={c.label} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden>›</span>}
                {c.href ? (
                  <Link href={c.href} className="hover:text-paper">
                    {c.label}
                  </Link>
                ) : (
                  <span className="text-accent">{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className={`core2-serif max-w-[36rem] leading-[1.04] ${big ? "text-[2.55rem] md:text-[3.45rem]" : "text-[2.1rem] md:text-[2.8rem]"}`}>{title}</h1>
        {big && <span aria-hidden className="mt-3 block h-1 w-14 rounded-full bg-accent md:mt-4 md:w-16" />}
        <p className={`mt-3 max-w-[30rem] leading-snug text-paper/75 ${big ? "text-[1.05rem] md:text-[1.2rem]" : "text-[0.95rem] md:text-base"}`}>{subtitle}</p>
      </div>
    </section>
  );
}
