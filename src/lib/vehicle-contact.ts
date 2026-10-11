/**
 * Abre o formulário "Pedir informações" da ficha, já com uma mensagem, e leva
 * o visitante até ele. O painel (`VehicleActions`) ouve este evento — há um em
 * mobile e outro no desktop, e só o visível responde.
 */
export const VEHICLE_CONTACT_EVENT = "vehicle-contact";

export type VehicleContactDetail = { mode: "info"; message: string };

export function openVehicleContact(message: string) {
  window.dispatchEvent(
    new CustomEvent<VehicleContactDetail>(VEHICLE_CONTACT_EVENT, {
      detail: { mode: "info", message },
    }),
  );
}
