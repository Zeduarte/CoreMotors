"use client";

import { useEffect, useRef, useState } from "react";
import type { Vehicle } from "@/types/vehicle";
import { vehiclePriceLabel } from "@/lib/format";
import { waHref, type Company } from "@/lib/branding";
import { site } from "@/lib/site";
import { useChat } from "@/components/chat/ChatContext";
import {
  MESSENGER_BLUE,
  MessengerIcon,
  PhoneIcon,
  WHATSAPP_GREEN,
  WhatsAppIcon,
} from "@/components/layout/ContactIcons";

/**
 * Sugestões curtas para o campo da barra. As do painel são mais longas e não
 * cabiam aqui em mobile — a meio da frase o convite deixa de se ler.
 */
const SUGESTOES = [
  "Tem garantia?",
  "É nacional?",
  "Quantos donos teve?",
];

/**
 * Barra de ação fixa no fundo da ficha de viatura.
 *
 * Com o assistente ativo, é por aqui que se começa uma conversa: o visitante
 * escreve a pergunta sem ter de procurar um botão. Os contactos humanos
 * (WhatsApp e telefone) ficam ao lado, porque há sempre quem prefira falar
 * com alguém. Sem assistente, mantém-se a barra de sempre.
 */
export function ContactBar({
  vehicle,
  company,
}: {
  vehicle: Vehicle;
  company: Company;
}) {
  const { enabled, openChat } = useChat();
  const [question, setQuestion] = useState("");
  const [hint, setHint] = useState(0);
  const bar = useRef<HTMLDivElement>(null);

  // A barra flutua sobre a página, por isso tapava o fim do rodapé. Reserva
  // o espaço que ocupa enquanto estiver montada, e devolve-o ao sair.
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const anterior = document.body.style.paddingBottom;
    const aplicar = () => {
      document.body.style.paddingBottom = `${el.offsetHeight}px`;
    };
    aplicar();
    const observer = new ResizeObserver(aplicar);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.body.style.paddingBottom = anterior;
    };
  }, []);

  // Roda as sugestões para convidar a perguntar — pára assim que escrevem.
  useEffect(() => {
    if (!enabled || question) return;
    const timer = setInterval(
      () => setHint((i) => (i + 1) % SUGESTOES.length),
      5000,
    );
    return () => clearInterval(timer);
  }, [enabled, question]);

  const url = `${site.url}/viaturas/${vehicle.slug}`;
  const message = `Olá! Tenho interesse no ${vehicle.make} ${vehicle.model} ${vehicle.year} (${vehiclePriceLabel(vehicle)}).\n${url}`;

  return (
    // `fixed`, não `sticky`: em `sticky` a barra só colava dentro da caixa
    // onde está, no fim do artigo — ficava a cinco ecrãs de distância e o
    // visitante nunca a via. Flutua sobre o anúncio de ponta a ponta.
    <div
      ref={bar}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink/95 backdrop-blur-xl"
    >
      <div className="container-px flex items-center gap-3 py-3">
        {/* O preço só cabe em ecrãs largos; em mobile o espaço é do chat. */}
        <div className="hidden lg:block">
          <p className="text-xs text-paper/50">
            {vehicle.make} {vehicle.model}
          </p>
          <p className="text-lg font-semibold text-accent">
            {vehiclePriceLabel(vehicle)}
          </p>
        </div>

        {enabled ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const text = question.trim() || SUGESTOES[hint]!;
              setQuestion("");
              openChat(text);
            }}
            // Em mobile ocupa a largura toda; em ecrãs largos um campo de
            // 1200px pareceria um formulário, não um convite a perguntar.
            className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-white/15 bg-white/5 pl-3 pr-1.5 focus-within:border-accent lg:max-w-xl"
          >
            <SparkIcon />
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={1000}
              placeholder={SUGESTOES[hint]}
              aria-label="Perguntar ao assistente sobre esta viatura"
              className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-paper placeholder:text-paper/40 focus:outline-none"
            />
            <button
              type="submit"
              aria-label="Enviar pergunta"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-ink transition-transform hover:scale-105"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 19V5M6 11l6-6 6 6" />
              </svg>
            </button>
          </form>
        ) : (
          <a
            href={company.phoneHref}
            className="flex flex-1 items-center justify-center gap-2 rounded-full border border-white/20 px-5 py-3 text-sm font-medium text-paper transition-colors hover:border-white/50"
          >
            Ligar
          </a>
        )}

        {/* Canais humanos, sempre à vista ao lado da caixa de pergunta. */}
        <div className="flex shrink-0 items-center gap-2">
          {company.messenger && (
            <a
              href={company.messenger}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Falar por Messenger"
              style={{ background: MESSENGER_BLUE }}
              className="grid h-10 w-10 place-items-center rounded-full text-white transition-transform hover:scale-105 sm:h-11 sm:w-11"
            >
              <MessengerIcon size={20} />
            </a>
          )}
          {company.whatsapp && (
            <a
              href={waHref(company.whatsapp, message)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Falar por WhatsApp sobre esta viatura"
              style={{ background: WHATSAPP_GREEN }}
              className="grid h-10 w-10 place-items-center rounded-full text-white transition-transform hover:scale-105 sm:h-11 sm:w-11"
            >
              <WhatsAppIcon size={20} />
            </a>
          )}
          <a
            href={company.phoneHref}
            aria-label={`Ligar ${company.phone}`}
            className="grid h-10 w-10 place-items-center rounded-full bg-accent text-ink transition-transform hover:scale-105 sm:h-11 sm:w-11"
          >
            <PhoneIcon />
          </a>
        </div>
      </div>
    </div>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-accent" aria-hidden>
      <path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
    </svg>
  );
}
