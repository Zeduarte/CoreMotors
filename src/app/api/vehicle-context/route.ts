import type { NextRequest } from "next/server";
import { switchVehicleContext } from "@/lib/vehicle-context-switch";

export function GET(request: NextRequest) {
  return switchVehicleContext(request);
}
