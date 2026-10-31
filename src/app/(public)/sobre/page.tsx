import type { Metadata } from "next";
import Link from "next/link";
import { AnimatedText } from "@/components/ui/AnimatedText";
import { Reveal } from "@/components/ui/Reveal";
import { Parallax } from "@/components/ui/Parallax";
import { getBranding } from "@/lib/queries";
import { COMMON_MEDIA } from "@/lib/media";

export const metadata: Metadata = {
  title: "Sobre",
  alternates: { canonical: "/sobre" },
  description:
    "Conheça o nosso stand de motas e automóveis — curadoria rigorosa, histórico transparente e uma experiência de compra sem fricção.",
};

export const revalidate = 300;

const VALUES = [
  {
    title: "Curadoria, não catálogo",
    body: "Não vendemos tudo. Escolhemos viaturas que compraríamos para nós — pelo estado, pelo histórico e pelo carácter.",
  },
  {
    title: "Transparência total",
    body: "Histórico verificável, inspeção documentada e preços sem jogos. O que vê é o que é.",
  },
  {
    title: "Experiência sem fricção",
    body: "Do primeiro contacto à entrega das chaves, tratamos de tudo — financiamento, retoma e burocracia incluídos.",
  },
];

const STATS = [
  { kpi: "12", label: "anos de experiência" },
  { kpi: "400+", label: "viaturas entregues" },
  { kpi: "4,9/5", label: "satisfação de clientes" },
  { kpi: "150", label: "pontos de inspeção" },
];

export default async function AboutPage() {
  const { companyName, company } = await getBranding();
  return (
    <div className="pb-24 pt-32 md:pt-40">
      <section className="container-px">
        <p className="eyebrow mb-6">Sobre o {companyName}</p>
        <AnimatedText
          as="h1"
          splitBy="word"
          highlight={["premium", "costume"]}
          className="max-w-4xl text-display font-bold text-paper"
        >
          Automóveis premium, sem o teatro do costume
        </AnimatedText>
        <p className="mt-8 max-w-2xl text-xl font-light leading-relaxed text-paper/60">
          Nascemos de uma frustração simples: comprar um carro usado devia ser
          entusiasmante, não stressante. Construímos o stand que gostaríamos de
          ter encontrado.
        </p>
      </section>

      {/* Banner com parallax subtil (≤12%). A foto (public/media/comum/sobre.jpg) é
          opcional: se faltar, fica o gradiente por baixo — nunca dá imagem
          partida. Basta colocar o ficheiro para aparecer automaticamente. */}
      <section className="container-px mt-20">
        <div className="relative aspect-[21/9] overflow-hidden rounded-3xl bg-gradient-to-br from-ink-muted via-ink to-black">
          <Parallax amount={0.12} className="absolute inset-0 scale-110">
            <div
              role="img"
              aria-label={`${companyName} — a nossa paixão por duas rodas`}
              className="h-full w-full bg-cover bg-center"
              style={{ backgroundImage: `url(${COMMON_MEDIA.sobre})` }}
            />
          </Parallax>
        </div>
      </section>

      {/* Stats */}
      <section className="container-px mt-24">
        <Reveal
          stagger={0.1}
          className="grid grid-cols-2 gap-8 md:grid-cols-4"
        >
          {STATS.map((s) => (
            <div key={s.label}>
              <p className="text-5xl font-bold text-accent md:text-6xl">
                {s.kpi}
              </p>
              <p className="mt-2 text-sm text-paper/50">{s.label}</p>
            </div>
          ))}
        </Reveal>
      </section>

      {/* Valores */}
      <section className="container-px mt-28">
        <AnimatedText
          as="h2"
          className="mb-14 max-w-2xl text-headline font-semibold text-paper"
        >
          Aquilo em que acreditamos
        </AnimatedText>
        <Reveal stagger={0.12} className="grid gap-10 md:grid-cols-3">
          {VALUES.map((v, i) => (
            <div key={v.title}>
              <p className="text-sm font-semibold text-accent">
                0{i + 1}
              </p>
              <h3 className="mt-4 text-xl font-semibold text-paper">
                {v.title}
              </h3>
              <p className="mt-3 font-light leading-relaxed text-paper/60">
                {v.body}
              </p>
            </div>
          ))}
        </Reveal>
      </section>

      <section className="container-px mt-28">
        <div className="rounded-3xl border border-white/10 bg-ink-soft p-10 text-center md:p-16">
          <h2 className="text-2xl font-semibold text-paper md:text-3xl">
            Venha conhecer-nos
          </h2>
          <p className="mx-auto mt-3 max-w-md font-light text-paper/60">
            O showroom está aberto {company.hours.toLowerCase()}. Sem marcação,
            sem pressão.
          </p>
          <Link
            href="/contactos"
            className="mt-8 inline-block rounded-full bg-accent px-8 py-3.5 text-sm font-semibold text-ink transition-transform duration-300 ease-premium hover:scale-[1.03]"
          >
            Ver morada e mapa
          </Link>
        </div>
      </section>
    </div>
  );
}
