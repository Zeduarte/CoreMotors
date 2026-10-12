import { getPublicVehicleType } from "@/lib/vehicle-context";
import type { Metadata } from "next";
import { getVehicleList } from "@/lib/queries";
import { CarQuiz } from "@/components/quiz/CarQuiz";
import { AnimatedText } from "@/components/ui/AnimatedText";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Encontre a sua viatura ideal",
  description:
    "Responda a 5 perguntas rápidas e descubra as viaturas do nosso stand mais indicadas para si.",
};

export default async function QuizPage() {
  const type = await getPublicVehicleType();
  const vehicles = await getVehicleList();

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
            {type === "motorcycle" ? "Encontre a sua mota ideal" : "Encontre o seu carro ideal"}
          </AnimatedText>
          <p className="mt-4 text-lg font-light text-paper/60">
            Responda a 5 perguntas rápidas e mostramos-lhe as viaturas do nosso
            stand mais indicadas para si.
          </p>
        </header>

        <div className="mb-24">
          <CarQuiz vehicles={vehicles} />
        </div>
      </div>
    </section>
  );
}
