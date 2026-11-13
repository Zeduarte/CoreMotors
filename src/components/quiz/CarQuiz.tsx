"use client";

import { useVehicleWorld } from "@/components/site/VehicleWorld";
import { MOTORCYCLE_BODIES, type VehicleType } from "@/lib/vehicle-categories";
import { mediaFor } from "@/lib/media";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { VehicleCard } from "@/components/vehicle/VehicleCard";
import type { Vehicle } from "@/types/vehicle";

/**
 * Quiz "encontre o seu veículo ideal".
 *
 * Começa por perguntar se procura carro ou mota (só num site com os dois);
 * depois seguem as perguntas desse tipo, e as sugestões são só desse tipo.
 *
 * Puramente no cliente: pontua o inventário recebido do servidor de acordo com
 * as respostas e apresenta as melhores correspondências. Sem chamadas à BD —
 * rápido e funciona offline depois de carregado.
 */

type Answers = {
  budget?: string;
  body?: string;
  fuel?: string;
  transmission?: string;
  usage?: string;
};

const STEPS = [
  {
    key: "budget" as const,
    title: "Qual é o seu orçamento?",
    options: [
      { value: "0-10000", label: "Até 10.000 €" },
      { value: "10000-20000", label: "10.000 – 20.000 €" },
      { value: "20000-40000", label: "20.000 – 40.000 €" },
      { value: "40000-70000", label: "40.000 – 70.000 €" },
      { value: "70000-999999999", label: "Mais de 70.000 €" },
    ],
  },
  {
    key: "body" as const,
    title: "Que tipo de carro procura?",
    options: [
      { value: "SUV", label: "SUV" },
      { value: "Berlina", label: "Berlina" },
      { value: "Citadino", label: "Citadino" },
      { value: "Carrinha", label: "Carrinha" },
      { value: "Coupé", label: "Coupé / Desportivo" },
      { value: "any", label: "Indiferente" },
    ],
  },
  {
    key: "fuel" as const,
    title: "Que combustível prefere?",
    options: [
      { value: "Gasolina", label: "Gasolina" },
      { value: "Diesel", label: "Diesel" },
      { value: "Híbrido", label: "Híbrido" },
      { value: "Elétrico", label: "Elétrico" },
      { value: "any", label: "Indiferente" },
    ],
  },
  {
    key: "transmission" as const,
    title: "Caixa manual ou automática?",
    options: [
      { value: "Automática", label: "Automática" },
      { value: "Manual", label: "Manual" },
      { value: "any", label: "Indiferente" },
    ],
  },
  {
    key: "usage" as const,
    title: "Qual vai ser a utilização principal?",
    options: [
      { value: "city", label: "Cidade / dia a dia" },
      { value: "family", label: "Família / conforto" },
      { value: "travel", label: "Viagens longas" },
      { value: "performance", label: "Desporto / prazer de conduzir" },
    ],
  },
];

export function scoreVehicle(v: Vehicle, a: Answers): number {
  let score = 0;

  if (a.budget) {
    const [min = 0, max = Infinity] = a.budget.split("-").map(Number);
    const price = v.price || 0;
    // «Mais de X €»: o último escalão não tem teto.
    const openEnded = max >= 999999;
    if (v.priceOnRequest) {
      // Sob consulta costuma ser caro: só conta no escalão mais alto.
      score += openEnded ? 15 : -40;
    } else if (price >= min && price <= max) {
      score += 40;
    } else if (price > max && price <= max + 5000) {
      score += 15; // um pouco acima do orçamento
    } else if (price > max) {
      // Muito acima do orçamento: não pode passar à frente das que cabem.
      score -= 40;
    }
    // Abaixo do mínimo: cabe no orçamento, mas não é o que se pediu (0 pontos).
  }

  if (a.body && a.body !== "any" && v.body === a.body) score += 25;
  if (a.fuel && a.fuel !== "any") {
    if (v.fuel === a.fuel) score += 20;
    else if (a.fuel === "Híbrido" && v.fuel === "Híbrido Plug-in") score += 18;
  }
  if (a.transmission && a.transmission !== "any" && v.transmission === a.transmission)
    score += 10;

  if (a.usage) {
    if (a.usage === "city" && (v.body === "Citadino" || v.body === "SUV" || v.body === "Scooter" || v.body === "Naked")) score += 8;
    if (a.usage === "family" && (v.body === "SUV" || v.body === "Carrinha" || v.body === "Monovolume"))
      score += 8;
    if (a.usage === "travel" && (v.fuel === "Diesel" || v.body === "Berlina" || v.body === "SUV" || v.body === "Touring" || v.body === "Trail"))
      score += 8;
    if (a.usage === "performance" && (v.body === "Coupé" || v.body === "Desportiva" || v.power >= 250)) score += 10;
  }

  if (v.featured) score += 3;
  return score;
}

/** As perguntas de cada tipo: as dos carros, adaptadas nas motas. */
function stepsFor(kind: VehicleType) {
  return STEPS.map(s => {
    if (kind !== "motorcycle") return s;
    if (s.key === "body") return {...s,title:"Que tipo de mota procura?",options:[...MOTORCYCLE_BODIES.map(value=>({value,label:value})),{value:"any",label:"Indiferente"}]};
    if (s.key === "budget") return {...s,options:[{value:"0-5000",label:"Até 5.000 €"},{value:"5000-10000",label:"5.000 – 10.000 €"},{value:"10000-20000",label:"10.000 – 20.000 €"},{value:"20000-999999999",label:"Mais de 20.000 €"}]};
    if (s.key === "fuel") return {...s,options:s.options.filter(o=>["Gasolina","Elétrico","any"].includes(o.value))};
    if (s.key === "usage") return {...s,options:s.options.filter(o=>o.value!=="family")};
    return s;
  });
}

/** A primeira pergunta, num site com carros e motas. */
const KIND_STEP = {
  key: "kind" as const,
  title: "Procura carro ou mota?",
  options: [
    { value: "car", label: "Carro" },
    { value: "motorcycle", label: "Mota" },
  ],
};

export function CarQuiz({
  vehicles,
  vehicleTypes = ["car", "motorcycle"],
}: {
  vehicles: Vehicle[];
  /** O que o site vende. Com os dois tipos, a primeira pergunta é carro ou mota. */
  vehicleTypes?: VehicleType[];
}) {
  const primary = useVehicleWorld();
  const askKind = vehicleTypes.length > 1;
  // O tipo escolhido (num site de um só tipo, é esse desde o início).
  const [kind, setKind] = useState<VehicleType | null>(askKind ? null : (vehicleTypes[0] ?? primary));
  // Antes de escolher, mostram-se as perguntas do tipo principal só para contar os passos.
  const steps = [...(askKind ? [KIND_STEP] : []), ...stepsFor(kind ?? primary)];
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [done, setDone] = useState(false);

  const results = useMemo(() => {
    if (!done) return [];
    return vehicles
      .filter((v) => !kind || (v.vehicleType ?? "car") === kind)
      .map((v) => ({ v, score: scoreVehicle(v, answers) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((r) => r.v);
  }, [done, vehicles, answers, kind]);

  function pick(value: string) {
    const key = steps[step]!.key;
    if (key === "kind") {
      // Mudar de tipo recomeça as respostas: as opções são outras.
      setKind(value as VehicleType);
      setAnswers({});
      setStep(step + 1);
      return;
    }
    const next = { ...answers, [key]: value };
    setAnswers(next);
    if (step + 1 < steps.length) setStep(step + 1);
    else setDone(true);
  }

  function restart() {
    setAnswers({});
    setStep(0);
    setDone(false);
    if (askKind) setKind(null);
  }

  if (done) {
    return (
      <div>
        <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-2xl font-semibold text-paper">
              {results.length > 0
                ? "As nossas sugestões para si"
                : "Ainda não temos uma correspondência exata"}
            </h2>
            <p className="mt-1 text-sm text-paper/60">
              {results.length > 0
                ? "Com base nas suas respostas, estas são as viaturas mais indicadas."
                : "Fale connosco — encontramos a viatura certa para si."}
            </p>
          </div>
          <button onClick={restart} className="btn-ghost shrink-0">
            ↺ Recomeçar
          </button>
        </div>

        {results.length > 0 ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((v) => (
              <VehicleCard key={v.slug} vehicle={v} />
            ))}
          </div>
        ) : (
          <a href="/contactos" className="btn-primary inline-flex">
            Falar com a equipa
          </a>
        )}
      </div>
    );
  }

  const current = steps[step]!;
  // Na pergunta «carro ou mota?» (também ao voltar a ela), o banner é o geral.
  const shownKind = current.key === "kind" ? null : kind;
  const progress = Math.round((step / steps.length) * 100);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8">
        <div className="mb-2 flex items-center justify-between text-xs text-paper/50">
          <span>
            Passo {step + 1} de {steps.length}
          </span>
          <span>{progress}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full bg-accent"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={current.key}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.25 }}
        >
          <h2 className="text-2xl font-semibold text-paper md:text-3xl">
            {current.title}
          </h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {current.options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => pick(opt.value)}
                className="rounded-2xl border border-white/10 bg-ink-soft px-5 py-4 text-left text-sm font-medium text-paper transition-all hover:border-accent hover:bg-accent/5"
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Banner do quiz (em todos os passos) — imagem definível em
              quiz.jpg em public/media/carros|motas/ (fallback: fundo sólido). */}
          <div
            className="relative mt-6 h-40 overflow-hidden rounded-2xl border border-white/10 bg-ink-soft bg-cover bg-center md:h-56"
            style={{ backgroundImage: `url(${mediaFor(shownKind ?? primary).quiz})` }}
          >
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/20 to-transparent"
            />
            <div className="absolute bottom-4 left-5">
              <p className="eyebrow mb-1">
                {shownKind === "motorcycle"
                  ? "Encontre a sua mota ideal"
                  : shownKind === "car"
                    ? "Encontre o seu carro ideal"
                    : "Encontre o seu veículo ideal"}
              </p>
              <p className="text-lg font-semibold text-paper">
                Sem surpresas, sem pressão.
              </p>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      {step > 0 && (
        <button
          onClick={() => setStep(step - 1)}
          className="mt-6 text-sm text-paper/50 transition-colors hover:text-paper"
        >
          ← Voltar
        </button>
      )}
    </div>
  );
}
