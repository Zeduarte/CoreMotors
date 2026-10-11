"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { waHref, type Company } from "@/lib/branding";
import {
  PhoneIcon,
  WHATSAPP_GREEN,
  WhatsAppIcon,
} from "@/components/layout/ContactIcons";
import { InfoForm } from "./InfoForm";
import { OfferForm } from "./OfferForm";
import { ReserveForm } from "./ReserveForm";

/** Só se mostra a partir daqui — "2 visitas" mais afasta do que convence. */
const MIN_VIEWS = 5;

type Form = "callback" | "offer" | "reserve";

const FORM_TITLE: Record<Form, string> = {
  callback: "Pedir que lhe liguem",
  offer: "Fazer uma proposta",
  reserve: "Reservar viatura",
};

/**
 * Cartão do topo da ficha, ao lado das fotos: preço e "Interessado?".
 *
 * O WhatsApp vem primeiro — a mensagem já está escrita (as perguntas rápidas
 * trocam-na com um toque) e segue com o link da viatura. Logo abaixo, ligar
 * para o stand ou pedir que liguem (fica como lead no backoffice). Proposta e
 * reserva abrem numa janela, para o cartão não crescer e desalinhar da foto.
 */
export function InterestCard({
  vehicleName,
  shortName,
  vehicleId,
  url,
  status,
  company,
  price,
  priceValue,
  warrantyMonths,
  recentViews,
  canReserve,
  depositAmount,
}: {
  /** "Marca Modelo Ano", para as mensagens. */
  vehicleName: string;
  /** "Marca Modelo", para os formulários. */
  shortName: string;
  vehicleId?: string;
  url: string;
  status: string;
  company: Company;
  /** Preço já formatado (com o preço anterior, se estiver em campanha). */
  price: ReactNode;
  priceValue: number | null;
  warrantyMonths?: number | null;
  recentViews: number | null;
  canReserve: boolean;
  depositAmount: number;
}) {
  const sold = status === "sold";
  const reserved = status === "reserved";

  const questions = sold
    ? ["Têm alguma semelhante?", "Avisem-me quando entrar outra"]
    : reserved
      ? ["Posso ficar em lista de espera?", "Têm alguma semelhante?"]
      : ["Ainda está disponível?", "Aceitam retoma?", "Tem financiamento?", "Posso marcar uma visita?"];
  const opening = sold
    ? `Olá! Vi o ${vehicleName}, que já foi vendido. Têm alguma semelhante?`
    : reserved
      ? `Olá! Vi que o ${vehicleName} está reservado. Posso ficar em lista de espera?`
      : `Olá! Tenho interesse no ${vehicleName}. Ainda está disponível?`;

  const [text, setText] = useState(opening);
  const [picked, setPicked] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  // Janela nativa (`showModal`): foco preso, Esc fecha e fica por cima de tudo.
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (form && !d.open) d.showModal();
    if (!form && d.open) d.close();
  }, [form]);

  const views = recentViews !== null && recentViews >= MIN_VIEWS && !sold ? recentViews : null;
  const message = text.trim() || opening;

  const secondary =
    "flex items-center justify-center gap-2 whitespace-nowrap rounded-full border border-white/15 px-2 py-2.5 text-sm font-semibold text-paper transition-colors hover:border-accent hover:text-accent";

  return (
    // `data-chat-target` — o assistente virtual rola até aqui quando encaminha.
    <section
      data-chat-target="interessado"
      aria-labelledby="interessado"
      className="scroll-mt-28 rounded-3xl bg-ink-soft p-5"
    >
      <div className="flex items-center justify-between gap-4">
        <span className="text-lg font-medium text-paper/80">Preço de venda</span>
        <span className="text-3xl font-bold text-accent">{price}</span>
      </div>
      {(warrantyMonths || views) && (
        <p className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
          <span className="text-paper/55">
            {views && (
              <>
                <span aria-hidden>👀 </span>
                {views} visitas nos últimos 7 dias
              </>
            )}
          </span>
          {warrantyMonths ? (
            <span className="font-medium text-paper/80">Garantia de {warrantyMonths} meses</span>
          ) : null}
        </p>
      )}

      <div className="mt-4 border-t border-white/10 pt-4">
        <h2 id="interessado" className="text-base font-semibold text-paper">
          Interessado? <span className="font-normal text-paper/50">Sem compromisso.</span>
        </h2>

        {/* Perguntas rápidas: um toque e a mensagem fica escrita. */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {questions.map((q) => (
            <button
              key={q}
              type="button"
              aria-pressed={picked === q}
              onClick={() => {
                setPicked(q);
                setText(`Olá! Sobre o ${vehicleName}: ${q}`);
              }}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                picked === q
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-white/15 bg-white/5 text-paper/80 hover:border-accent hover:text-accent"
              }`}
            >
              {q}
            </button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPicked(null);
          }}
          rows={2}
          maxLength={1000}
          aria-label="Mensagem"
          className="field mt-2 resize-none text-sm"
        />

        {company.whatsapp ? (
          <a
            href={waHref(company.whatsapp, `${message}\n${url}`)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ background: WHATSAPP_GREEN }}
            className="mt-3 flex items-center justify-center gap-2.5 rounded-full px-5 py-3.5 text-base font-semibold text-white transition-transform hover:scale-[1.01] active:scale-[0.99]"
          >
            <WhatsAppIcon size={22} />
            Enviar por WhatsApp
          </a>
        ) : (
          <button
            type="button"
            onClick={() => setForm("callback")}
            className="mt-3 w-full rounded-full bg-accent px-5 py-3.5 text-base font-semibold text-ink transition-transform hover:scale-[1.01]"
          >
            Enviar mensagem
          </button>
        )}

        <div className="mt-2 grid grid-cols-2 gap-2">
          <a href={company.phoneHref} aria-label={`Ligar ${company.phone}`} className={secondary}>
            <PhoneIcon size={16} />
            Ligar
          </a>
          <button type="button" onClick={() => setForm("callback")} className={secondary}>
            Pedir que me liguem
          </button>
        </div>

        {!sold && (
          <p className="mt-3 flex items-center justify-center gap-3 text-xs text-paper/60">
            <button
              type="button"
              onClick={() => setForm("offer")}
              className="underline-offset-4 transition-colors hover:text-accent hover:underline"
            >
              Fazer uma proposta
            </button>
            {canReserve && (
              <>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  onClick={() => setForm("reserve")}
                  className="underline-offset-4 transition-colors hover:text-accent hover:underline"
                >
                  Reservar online
                </button>
              </>
            )}
          </p>
        )}
      </div>

      <dialog
        ref={dialog}
        data-lenis-prevent
        aria-label={form ? FORM_TITLE[form] : undefined}
        onClose={() => setForm(null)}
        // Clicar no fundo escuro (fora da caixa) fecha.
        onClick={(e) => e.target === e.currentTarget && setForm(null)}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-3xl border border-white/10 bg-ink-soft p-0 text-paper backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      >
        {form && (
          <div className="p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-paper">{FORM_TITLE[form]}</h2>
                <p className="mt-1 text-sm text-paper/55">{shortName}</p>
              </div>
              <button
                type="button"
                onClick={() => setForm(null)}
                aria-label="Fechar"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-paper transition-colors hover:bg-white/20"
              >
                ✕
              </button>
            </div>
            {form === "callback" && (
              <InfoForm
                vehicleName={shortName}
                vehicleId={vehicleId}
                initialMessage={message}
                submitLabel="Pedir que me liguem"
              />
            )}
            {form === "offer" && (
              <OfferForm vehicleName={shortName} vehicleId={vehicleId} price={priceValue} />
            )}
            {form === "reserve" && (
              <ReserveForm
                vehicleName={shortName}
                vehicleId={vehicleId}
                depositAmount={depositAmount}
                bare
              />
            )}
          </div>
        )}
      </dialog>
    </section>
  );
}
