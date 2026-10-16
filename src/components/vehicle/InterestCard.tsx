"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { waHref, type Company } from "@/lib/branding";
import {
  PhoneIcon,
  WHATSAPP_GREEN,
  WhatsAppIcon,
} from "@/components/layout/ContactIcons";
import dynamic from "next/dynamic";
import { PriceSummary, visibleViews } from "./PriceSummary";

// Os formulários só são descarregados quando se abre a janela (a maior parte
// das visitas usa o WhatsApp ou o telefone e nunca os vê).
const formLoading = () => <div className="h-72 animate-pulse rounded-2xl bg-white/[0.04]" />;
const InfoForm = dynamic(() => import("./InfoForm").then((m) => m.InfoForm), { ssr: false, loading: formLoading });
const OfferForm = dynamic(() => import("./OfferForm").then((m) => m.OfferForm), { ssr: false, loading: formLoading });
const ReserveForm = dynamic(() => import("./ReserveForm").then((m) => m.ReserveForm), { ssr: false, loading: formLoading });
const VisitForm = dynamic(() => import("./VisitForm").then((m) => m.VisitForm), { ssr: false, loading: formLoading });

type Form = "callback" | "offer" | "reserve" | "visit";

const FORM_TITLE: Record<Form, string> = {
  callback: "Pedir que lhe liguem",
  offer: "Fazer uma proposta",
  reserve: "Reservar viatura",
  visit: "Marcar visita ao stand",
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
  visit,
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
  /** Marcação de visitas ligada: o nome e a morada do stand, para a agenda. */
  visit?: { companyName: string; address: string } | null;
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

  const views = visibleViews(recentViews, status);
  const message = text.trim() || opening;

  const secondary =
    "flex items-center justify-center gap-2 whitespace-nowrap rounded-full border border-white/15 px-2 py-2.5 text-[13px] font-semibold text-paper transition-colors hover:border-accent hover:text-accent sm:text-sm";

  return (
    // `data-chat-target` — o assistente virtual rola até aqui quando encaminha.
    <section
      data-chat-target="interessado"
      aria-labelledby="interessado"
      className="scroll-mt-28 rounded-3xl bg-ink-soft p-5"
    >
      {/* No telemóvel o preço vai com os dados da viatura, antes deste cartão
          (ver a página); aqui só aparece no computador. */}
      <div className="mb-4 hidden border-b border-white/10 pb-4 xl:block">
        <PriceSummary price={price} warrantyMonths={warrantyMonths} views={views} />
      </div>

      <div>
        <h2 id="interessado" className="text-base font-semibold text-paper">
          Interessado?
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

        <div className="mt-2 grid gap-2 min-[360px]:grid-cols-2">
          <a href={company.phoneHref} aria-label={`Ligar ${company.phone}`} className={secondary}>
            <PhoneIcon size={16} />
            Ligar
          </a>
          <button type="button" onClick={() => setForm("callback")} className={secondary}>
            Pedir que me liguem
          </button>
        </div>

        {!sold && (
          <div className={`mt-2 grid gap-2 ${canReserve ? "min-[360px]:grid-cols-2" : ""}`}>
            <button
              type="button"
              onClick={() => setForm("offer")}
              className="flex items-center justify-center gap-2 whitespace-nowrap rounded-full border border-accent/60 bg-accent/10 px-2 py-2.5 text-sm font-semibold text-accent transition-colors hover:bg-accent hover:text-ink"
            >
              <OfferIcon />
              Fazer uma proposta
            </button>
            {canReserve && (
              <button type="button" onClick={() => setForm("reserve")} className={secondary}>
                Reservar online
              </button>
            )}
          </div>
        )}
        {!sold && visit && vehicleId && (
          <button
            type="button"
            onClick={() => setForm("visit")}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-white/15 px-2 py-2.5 text-sm font-semibold text-paper transition-colors hover:border-accent hover:text-accent"
          >
            <CalendarIcon />
            Marcar visita ao stand
          </button>
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
              <OfferForm
                vehicleName={shortName}
                vehicleId={vehicleId}
                price={priceValue}
                whatsappHref={
                  company.whatsapp
                    ? (amount) =>
                        waHref(
                          company.whatsapp,
                          `Olá! Gostaria de fazer uma proposta de ${amount} € pelo ${vehicleName}.\n${url}`,
                        )
                    : undefined
                }
              />
            )}
            {form === "visit" && visit && vehicleId && (
              <VisitForm
                vehicleId={vehicleId}
                vehicleName={vehicleName}
                companyName={visit.companyName}
                address={visit.address}
                phoneHref={company.phoneHref}
              />
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

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M8 2.5v4M16 2.5v4M3 9.5h18" />
    </svg>
  );
}

function OfferIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </svg>
  );
}
