import { inventoryVehicleType } from "./vehicle-categories";

/**
 * `/inventario?tipo=motas&marca=…` (links antigos e partilhados): se o mundo
 * pedido não é o escolhido, devolve o endereço que muda o mundo e volta ao
 * stock com a mesma pesquisa (sem o `tipo`); senão, `null`.
 *
 * Normalmente quem o faz é o redirecionamento do next.config.mjs (um 307 a
 * sério, antes da página); a página usa isto de reserva.
 */
export function inventoryRedirect(
  params: URLSearchParams,
  selected: string | undefined,
): string | null {
  const requested = inventoryVehicleType(params.get("tipo") ?? undefined);
  if (!requested || requested === selected) return null;
  const rest = new URLSearchParams(params);
  rest.delete("tipo");
  const query = rest.toString();
  return `/api/vehicle-context?area=public&type=${requested}&target=${encodeURIComponent(`/inventario${query ? `?${query}` : ""}`)}`;
}
