"use client";

import { waHref, type Company } from "@/lib/branding";
import { openVehicleContact } from "@/lib/vehicle-contact";
import {
  PhoneIcon,
  WHATSAPP_GREEN,
  WhatsAppIcon,
} from "@/components/layout/ContactIcons";

/** Só se mostra a partir daqui — "2 visitas" mais afasta do que convence. */
const MIN_VIEWS = 5;

/**
 * Contacto rápido logo a seguir ao preço, no primeiro ecrã da ficha.
 *
 * O visitante não tem de procurar como falar connosco: o WhatsApp vem com a
 * mensagem já escrita (viatura + link) e as perguntas mais comuns estão a um
 * toque. Sem WhatsApp configurado, as perguntas abrem o formulário já
 * preenchido.
 */
export function QuickContact({
  vehicleName,
  url,
  status,
  company,
  recentViews,
}: {
  vehicleName: string;
  url: string;
  status: string;
  company: Company;
  recentViews: number | null;
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
      : `Olá! Tenho interesse no ${vehicleName}.`;

  const wa = (text: string) => waHref(company.whatsapp, `${text}\n${url}`);
  const ask = (q: string) =>
    company.whatsapp ? undefined : () => openVehicleContact(`Olá! Sobre o ${vehicleName}: ${q}`);

  return (
    <div className="rounded-3xl border border-white/10 bg-ink-soft p-5 md:p-6">
      <div className="grid gap-3">
        {company.whatsapp ? (
          <a
            href={wa(opening)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ background: WHATSAPP_GREEN }}
            className="flex items-center justify-center gap-2.5 rounded-2xl px-5 py-4 text-base font-semibold text-white transition-transform hover:scale-[1.01] active:scale-[0.99]"
          >
            <WhatsAppIcon size={22} />
            Falar por WhatsApp
          </a>
        ) : (
          <button
            type="button"
            onClick={() => openVehicleContact(opening)}
            className="rounded-2xl bg-accent px-5 py-4 text-base font-semibold text-ink transition-transform hover:scale-[1.01]"
          >
            Pedir informações
          </button>
        )}

        <div className="grid grid-cols-2 gap-3">
          <a
            href={company.phoneHref}
            className="flex items-center justify-center gap-2 rounded-2xl border border-white/15 px-4 py-3 text-sm font-semibold text-paper transition-colors hover:border-accent hover:text-accent"
          >
            <PhoneIcon size={16} />
            Ligar
          </a>
          <button
            type="button"
            onClick={() => openVehicleContact(opening)}
            className="flex items-center justify-center gap-2 rounded-2xl border border-white/15 px-4 py-3 text-sm font-semibold text-paper transition-colors hover:border-accent hover:text-accent"
          >
            <span aria-hidden>✉</span>
            Enviar mensagem
          </button>
        </div>
      </div>

      {/* Perguntas rápidas: um toque e a conversa começa. */}
      <p className="mt-5 text-xs font-medium uppercase tracking-wider text-paper/40">
        Pergunte num toque
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {questions.map((q) =>
          company.whatsapp ? (
            <a
              key={q}
              href={wa(`Olá! Sobre o ${vehicleName}: ${q}`)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-white/15 bg-white/5 px-3.5 py-2 text-sm text-paper/85 transition-colors hover:border-accent hover:text-accent"
            >
              {q}
            </a>
          ) : (
            <button
              key={q}
              type="button"
              onClick={ask(q)}
              className="rounded-full border border-white/15 bg-white/5 px-3.5 py-2 text-sm text-paper/85 transition-colors hover:border-accent hover:text-accent"
            >
              {q}
            </button>
          ),
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-white/10 pt-4 text-xs text-paper/50">
        <span>Sem compromisso.</span>
        {recentViews !== null && recentViews >= MIN_VIEWS && !sold && (
          <span className="text-paper/70">
            <span aria-hidden>👀 </span>
            {recentViews} visitas nos últimos 7 dias
          </span>
        )}
      </div>
    </div>
  );
}
