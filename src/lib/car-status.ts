import type { CarStatus } from "@/lib/supabase/database.types";

/**
 * Mudanças de estado feitas à mão: a lista de Viaturas, as ações em lote e a
 * ficha. Função pura — o servidor decide com ela e a interface usa-a para só
 * oferecer o que vai ser aceite.
 *
 *  - «Vendida» só pelo contacto («Concluir venda»): fica o preço, a data e a
 *    margem. Marcada à mão ficava vendida sem nada disso.
 *  - «Reservada» só pelo contacto («Confirmar reserva»): a reserva tem prazo e
 *    sinal e expira sozinha. Marcada à mão ficava reservada para sempre.
 *  - Sair de «Vendida» é para corrigir um engano: só o administrador, e nunca
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
}

export const SOLD_VIA_LEAD =
  "Para vender, abra o contacto do cliente e use «Concluir venda»: fica registado o preço, a data e a margem.";
export const RESERVED_VIA_LEAD =
  "Para reservar, abra o contacto do cliente e use «Confirmar reserva»: a reserva tem prazo e sinal, e expira sozinha.";

export function manualStatusError(
  from: CarStatus | null,
  to: CarStatus,
  ctx: StatusChangeContext,
): string | null {
  if (from === to) return null;
  if (to === "sold") return SOLD_VIA_LEAD;
  if (to === "reserved") return RESERVED_VIA_LEAD;
  if (from === "reserved" && ctx.activeReservation)
    return "A viatura tem uma reserva ativa: cancele-a no contacto do cliente.";
  if (from === "sold") {
    if (ctx.saleRecorded)
      return "A venda foi concluída num contacto e não se desfaz aqui.";
    if (!ctx.isAdmin)
      return "Só um administrador pode tirar uma viatura de «Vendida».";
  }
  return null;
}

/** Os estados que se oferecem para uma viatura (o atual incluído). */
export function manualStatusOptions(from: CarStatus, isAdmin: boolean): CarStatus[] {
  const free: CarStatus[] = ["draft", "prepared", "published"];
  if (from === "sold") return isAdmin ? ["sold", ...free] : ["sold"];
  if (from === "reserved" || from === "workshop") return [from, ...free];
  return free;
}

/** Aviso a confirmar antes de um administrador tirar uma viatura de «Vendida». */
export const UNSELL_CONFIRM =
  "Tirar esta viatura de «Vendida»? Use só para corrigir um engano: a viatura volta ao stand com o estado escolhido.";
