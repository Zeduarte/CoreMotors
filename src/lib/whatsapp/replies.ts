/**
 * As frases fixas do canal, num sítio só.
 *
 * Nunca se devolve ao WhatsApp a mensagem de erro do Postgres nem do modelo: o
 * erro real vai para o log e para `wa_messages.error`, e a pessoa lê uma destas.
 */
export const REPLIES = {
  semSecao: (secao: string) =>
    `Não tem acesso a ${secao}. Fale com o responsável.`,
  soTexto: "Por agora só entendo mensagens de texto e fotografias.",
  semAssistente: "O assistente não está configurado.",
  falhou: "Não consegui processar agora. Tente daqui a pouco.",
  demasiadas: "Demasiadas mensagens em pouco tempo. Aguarde uns minutos.",
  expirou: "Esse pedido já expirou. Repita, por favor.",
  nadaPendente: "Não tenho nada à espera de confirmação.",
  cancelado: "Cancelado. Não registei nada.",
  jaNaoDa: "Já não foi possível: a viatura deixou de existir.",
  /** O mesmo, para contactos e testemunhos (ou acesso retirado entretanto). */
  registoSumiu: "Já não foi possível: esse registo deixou de existir ou deixou de ter acesso.",
  jaEstava: "Não foi preciso: já estava assim.",
  naoEncontrei: "Não encontrei essa viatura. Indique a matrícula.",
  foraDoAmbito: "Isso não dá para fazer por aqui. Use o backoffice.",
  // Reservar e vender têm fluxo próprio no backoffice: dizer onde, em vez de
  // um «não dá» seco.
  reservaNoBackoffice:
    "Uma reserva faz-se no contacto do cliente, no backoffice (prazo e sinal).",
  vendaNoBackoffice:
    "Uma venda conclui-se no contacto do cliente, no backoffice («Concluir venda», com o preço e a data).",
  reservaAtiva:
    "Há uma reserva ativa. Cancele-a primeiro no contacto do cliente, no backoffice.",
} as const;

/** Nome da secção como aparece no menu, para as mensagens de recusa. */
export const SECTION_LABEL: Record<string, string> = {
  oficina: "Oficina",
  financeiro: "Custos e margens",
  carros: "Viaturas",
  leads: "Leads",
  testemunhos: "Testemunhos",
  "pagina-inicial": "Página inicial",
  definicoes: "Definições",
};
