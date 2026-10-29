import type { Metadata } from "next";
import { AnimatedText } from "@/components/ui/AnimatedText";
import { TradeInForm } from "@/components/forms/TradeInForm";
import { OrderCarForm } from "@/components/forms/OrderCarForm";

export const metadata: Metadata = {
  title: "Vender ou Encomendar",
  alternates: { canonical: "/vender" },
  description:
    "Avalie a retoma da sua viatura ou encomende a viatura que procura. Resposta rápida e sem compromisso.",
};

export default function SellPage() {
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
