"use client";

import { waHref } from "@/lib/branding";
import {
  MESSENGER_BLUE,
  MessengerIcon,
  WHATSAPP_GREEN,
  WhatsAppIcon,
} from "./ContactIcons";

/**
 * Botões flutuantes de contacto, presentes em todo o site público.
 *
 * Os canais disponíveis ficam todos à vista, um por cima do outro — antes
 * estavam escondidos atrás de um botão que era preciso abrir primeiro, o que
 * é um clique a mais para quem só quer falar com alguém.
 */
export function ContactFab({
  whatsapp,
  messenger,
  name,
}: {
  whatsapp: string;
  messenger: string;
  name: string;
}) {
  const channels = [
    messenger && {
      key: "messenger",
      label: "Messenger",
      href: messenger,
      bg: MESSENGER_BLUE,
      icon: <MessengerIcon />,
    },
    whatsapp && {
      key: "whatsapp",
      label: "WhatsApp",
      href: waHref(whatsapp, "Olá! Vi o vosso site e gostava de mais informações."),
      bg: WHATSAPP_GREEN,
      icon: <WhatsAppIcon />,
    },
  ].filter(Boolean) as {
    key: string;
    label: string;
    href: string;
    bg: string;
    icon: React.ReactNode;
  }[];

  if (channels.length === 0) return null;

  return (
    // O WhatsApp fica em baixo por ser o canal mais usado — é o que apanha
    // o polegar primeiro em mobile.
    <div className="contact-fab fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
      {channels.map((c) => (
        <a
          key={c.key}
          href={c.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Falar com o ${name} no ${c.label}`}
          style={{ background: c.bg }}
          className="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg shadow-black/30 transition-transform hover:scale-110"
        >
          {c.icon}
        </a>
      ))}
    </div>
  );
}
