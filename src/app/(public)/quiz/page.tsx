import type { Metadata, ResolvingMetadata } from "next";
import { pageMetadata } from "@/components/seo/page-metadata";
import { getSiteVehicleTypes, getVehicleList } from "@/lib/queries";
import { CarQuiz } from "@/components/quiz/CarQuiz";
import { AnimatedText } from "@/components/ui/AnimatedText";

export const revalidate = 60;

export function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, {
    path: "/quiz",
    title: "Encontre o seu veículo ideal",
    description:
      "Responda a umas perguntas rápidas e descubra as viaturas do nosso stand mais indicadas para si.",
  });
}

export default async function QuizPage() {
  // Todo o stock: o questionário começa por perguntar se procura carro ou
  // mota (num site de um só tipo, salta essa pergunta) e só sugere desse tipo.
  const [siteTypes, vehicles] = await Promise.all([getSiteVehicleTypes(), getVehicleList()]);

  return (
    <section className="pt-24 md:pt-32">
      <div className="container-px">
        <header className="mx-auto mb-12 max-w-2xl text-center">
          <p className="eyebrow mb-3">Assistente inteligente</p>
          <AnimatedText
            as="h1"
            className="text-headline font-semibold text-paper"
            highlight={["ideal"]}
          >
            Encontre o seu veículo ideal
          </AnimatedText>
          <p className="mt-4 text-lg font-light text-paper/60">
            Responda a umas perguntas rápidas e mostramos-lhe as viaturas do nosso
            stand mais indicadas para si.
          </p>
        </header>

        <div className="mb-24">
          <CarQuiz vehicles={vehicles} vehicleTypes={siteTypes} />
        </div>
      </div>
    </section>
  );
}
