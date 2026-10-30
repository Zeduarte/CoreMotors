import type { NextRequest } from "next/server";
import { switchVehicleContext } from "@/lib/vehicle-context-switch";

/**
 * A troca carros/motas do backoffice, dentro de /admin: a app instalada (PWA,
 * âmbito /admin/) não sai para o browser ao passar por aqui, como acontecia no
 * iOS com /api/vehicle-context. Mesmas regras e mesmos destinos permitidos.
 */
export function GET(request: NextRequest) {
  return switchVehicleContext(request, "admin");
}
