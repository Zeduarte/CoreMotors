"use client";

import { usePathname } from "next/navigation";
import { ContactFab } from "@/components/layout/ContactFab";
import { ChatWidget } from "./ChatWidget";
import { useChat } from "./ChatContext";

/**
 * Decide o que fica no canto do ecrã.
 *
 * O assistente virtual existe apenas na ficha de viatura, e entra-se nele
 * pela barra fixa do fundo (`ContactBar`) — não há botão flutuante para o
 * abrir. Este componente só monta o painel de conversa que essa barra usa.
 *
 * Em todas as outras páginas, e sempre que o assistente não esteja
 * configurado, fica o botão de contacto de sempre (WhatsApp/Messenger).
 */
export function ChatLauncher({
  whatsapp,
  messenger,
  name,
  chatEnabled,
}: {
  whatsapp: string;
  messenger: string;
  name: string;
  chatEnabled: boolean;
}) {
  const pathname = usePathname();
  const { open, question, closeChat, clearQuestion } = useChat();
  const onVehiclePage = /^\/viaturas\/[^/]+\/?$/.test(pathname);

  if (!onVehiclePage) {
    return <ContactFab whatsapp={whatsapp} messenger={messenger} name={name} />;
  }
  // Na ficha sem assistente, a barra do fundo já tem o WhatsApp e o telefone:
  // o botão flutuante repetia-os e ficava por cima do botão de ligar.
  if (!chatEnabled) return null;

  // Na ficha, os contactos humanos já estão na barra do fundo, ao lado do
  // campo de pergunta — um botão flutuante por cima seria repetição.
  return (
    <ChatWidget
      open={open}
      onClose={closeChat}
      companyName={name}
      initialQuestion={question}
      onQuestionSent={clearQuestion}
    />
  );
}
