import type { Metadata, ResolvingMetadata } from "next";
import { pageMetadata } from "@/components/seo/page-metadata";
import { AnimatedText } from "@/components/ui/AnimatedText";
import { TradeInForm } from "@/components/forms/TradeInForm";
import { OrderCarForm } from "@/components/forms/OrderCarForm";
import { getSiteTheme } from "@/lib/site-theme-query";

/**
 * /vender: no Core e no Core2, a retoma e a encomenda; no Core3 (o «Vender»
 * do menu), «Compramos o seu veículo» — só o formulário da avaliação.
 */
export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const sell = (await getSiteTheme()) === "core3";
  return pageMetadata(parent, {
    path: "/vender",
    title: sell ? "Compramos o seu veículo" : "Vender ou Encomendar",
    description: sell
      ? "Venda-nos a sua mota, moto 4 ou automóvel: diga-nos o que tem e fazemos-lhe uma proposta, sem compromisso."
      : "Avalie a retoma da sua viatura ou encomende a viatura que procura. Resposta rápida e sem compromisso.",
  });
}

export default async function SellPage() {
  if ((await getSiteTheme()) === "core3") {
    return (
      <div className="pb-24 pt-32 md:pt-40">
        <section className="container-px mx-auto max-w-3xl">
          <p className="eyebrow mb-6">Vender</p>
          <AnimatedText as="h1" splitBy="word" className="text-display font-bold text-paper">
            Compramos o seu veículo
          </AnimatedText>
          <p className="mt-6 max-w-xl text-lg font-light text-paper/60">
            Mota, moto 4 ou automóvel: diga-nos o que tem, avaliamos e fazemos-lhe uma proposta justa. Rápido e sem
            compromisso.
          </p>
          <div className="mt-12">
            <TradeInForm variant="sell" />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="pb-24 pt-32 md:pt-40">
      <section className="container-px">
        <p className="eyebrow mb-6">Retoma & Encomenda</p>
        <AnimatedText
          as="h1"
          splitBy="word"
          className="max-w-3xl text-display font-bold text-paper"
        >
          A sua viatura vale mais connosco
        </AnimatedText>
        <p className="mt-6 max-w-xl text-lg font-light text-paper/60">
          Avalie a sua retoma em minutos ou peça a viatura ideal — mesmo que
          ainda não esteja no nosso stock.
        </p>
      </section>

      <section className="container-px mt-16 grid gap-8 lg:grid-cols-2">
        <TradeInForm />
        <OrderCarForm />
      </section>
    </div>
  );
}
