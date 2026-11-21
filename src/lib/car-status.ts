import type { CarStatus } from "@/lib/supabase/database.types";

/**
 * Mudanças de estado feitas à mão: a lista de Viaturas, as ações em lote e a
 * ficha. Função pura — o servidor decide com ela e a interface usa-a para só
 * oferecer o que vai ser aceite.
 *
 *  - «Vendida» regista sempre o preço e a data (para a margem): no contacto
 *    («Concluir venda») ou, numa venda sem contacto, escolhendo «Vendida» na
 *    lista ou na ficha, que pede o preço e a data (`markCarSold`). Nunca
 *    como uma simples mudança de estado, que ficava sem preço nem data.
 *  - «Reservada» escolhe-se à mão (na lista ou na ficha) para uma reserva sem
 *    contacto: fica assim até alguém a mudar. A reserva com prazo e sinal, que
 *    expira sozinha, faz-se no contacto («Confirmar reserva») — e pede a
 *    viatura «Publicada».
 *  - Sair de «Vendida» é para corrigir um engano: só o administrador, uma a
 *    uma (na linha ou na ficha, com confirmação — nunca num lote, onde um
 *    «Selecionar tudo» + «Publicar» punha vendidas à venda sem aviso), e nunca
 *    quando a venda foi registada num contacto (o contacto ganho e a margem
 *    ficavam a apontar para uma viatura que voltou ao stand).
 *  - Sair de «Reservada» com uma reserva ativa: cancela-se no contacto (a base
 *    de dados também o exige — `protect_reserved_car`).
 */

export interface StatusChangeContext {
  isAdmin: boolean;
  /** A venda foi concluída num contacto (contacto ganho / venda registada). */
  saleRecorded?: boolean;
  /** Há uma reserva ativa para a viatura. */
  activeReservation?: boolean;
  /** Ação em lote (várias viaturas de uma vez, sem confirmação de cada uma). */
  bulk?: boolean;
}

export const SOLD_VIA_LEAD =
  "Para vender, escolha «Vendida» e indique o preço e a data (ou use «Concluir venda» no contacto do cliente).";

export function manualStatusError(
  from: CarStatus | null,
  to: CarStatus,
  ctx: StatusChangeContext,
): string | null {
  if (from === to) return null;
  if (to === "sold") return SOLD_VIA_LEAD;
  if (from === "reserved" && ctx.activeReservation)
    return "A viatura tem uma reserva ativa: cancele-a no contacto do cliente.";
  if (from === "sold") {
    if (ctx.saleRecorded)
      return "A venda foi concluída num contacto e não se desfaz aqui.";
    if (!ctx.isAdmin)
      return "Só um administrador pode tirar uma viatura de «Vendida».";
    if (ctx.bulk)
      return "está vendida: tira-se de «Vendida» uma a uma, na linha ou na ficha.";
  }
  return null;
}

/** Estados a partir dos quais se pode vender sem contacto (com preço e data). */
export const SELLABLE_FROM: CarStatus[] = ["draft", "prepared", "published", "reserved"];

/**
 * Os estados que se oferecem para uma viatura (o atual incluído). Com
 * `canSell` (acesso a Custos), também «Vendida» — que pede o preço e a data.
 */
export function manualStatusOptions(from: CarStatus, isAdmin: boolean, canSell = false): CarStatus[] {
  const free: CarStatus[] = ["draft", "prepared", "published", "reserved"];
  if (from === "sold") return isAdmin ? ["sold", ...free] : ["sold"];
  const sell: CarStatus[] = canSell && SELLABLE_FROM.includes(from) ? ["sold"] : [];
  if (from === "workshop") return [from, ...free, ...sell];
  return [...free, ...sell];
}

/** Aviso a confirmar antes de um administrador tirar uma viatura de «Vendida». */
export const UNSELL_CONFIRM =
  "Tirar esta viatura de «Vendida»? Use só para corrigir um engano: a viatura volta ao stand com o estado escolhido.";
