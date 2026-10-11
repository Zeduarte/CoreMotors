"use client";

import { waHref, type Company } from "@/lib/branding";
import { openVehicleContact } from "@/lib/vehicle-contact";
import {
  PhoneIcon,
  WHATSAPP_GREEN,
  WhatsAppIcon,
} from "@/components/layout/ContactIcons";

/**
 * Os dois botões do cartão do preço:
 * - "Pedir contacto" leva ao formulário "Interessado?" com a mensagem já
 *   escrita (a pessoa só deixa nome e telefone);
 * - "Fale connosco" abre o WhatsApp com a viatura e o link (sem WhatsApp
 *   configurado, liga para o stand).
 */
export function ContactButtons({
  vehicleName,
  url,
  status,
  company,
}: {
  vehicleName: string;
  url: string;
  status: string;
  company: Company;
}) {
  const opening =
    status === "sold"
      ? `Olá! Vi o ${vehicleName}, que já foi vendido. Têm alguma semelhante?`
      : status === "reserved"
        ? `Olá! Vi que o ${vehicleName} está reservado. Posso ficar em lista de espera?`
        : `Olá! Tenho interesse no ${vehicleName}.`;
  const callback =
    status === "published"
      ? `Olá! Gostaria que me contactassem sobre o ${vehicleName}.`
      : opening;

  const button =
    "flex items-center justify-center gap-2 whitespace-nowrap rounded-full px-2 py-3 text-sm font-semibold transition-transform hover:scale-[1.02] active:scale-[0.98]";

  return (
    <div className="mt-4 grid grid-cols-2 gap-3">
      <button
        type="button"
        onClick={() => openVehicleContact(callback)}
        className={`${button} border border-white/20 text-paper hover:border-accent hover:text-accent`}
      >
        <PhoneIcon size={16} />
        Pedir contacto
      </button>
      {company.whatsapp ? (
        <a
          href={waHref(company.whatsapp, `${opening}\n${url}`)}
          target="_blank"
          rel="noopener noreferrer"
          style={{ background: WHATSAPP_GREEN }}
          className={`${button} text-white`}
        >
          <WhatsAppIcon size={18} />
          Fale connosco
        </a>
      ) : (
        <a href={company.phoneHref} className={`${button} bg-accent text-ink`}>
          <PhoneIcon size={16} />
          Ligar
        </a>
      )}
    </div>
  );
}
