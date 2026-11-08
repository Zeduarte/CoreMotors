"use client";

import { createContext, useContext } from "react";
import type { VehicleType } from "@/lib/vehicle-categories";

/**
 * O site público é um só, com carros e motas juntos. Este contexto diz:
 * - o tipo principal (`useVehicleWorld`): o que dá o aspeto e os textos por
 *   defeito — os carros, salvo num site só de motas;
 * - os tipos que o site vende (`useSiteTypes`), de Definições → Tipo de site.
 */
const World = createContext<VehicleType>("car");
const Types = createContext<VehicleType[]>(["car", "motorcycle"]);

export function VehicleWorld({
  type,
  types,
  children,
}: {
  type: VehicleType;
  types: VehicleType[];
  children: React.ReactNode;
}) {
  return (
    <World.Provider value={type}>
      <Types.Provider value={types}>{children}</Types.Provider>
    </World.Provider>
  );
}

export function useVehicleWorld() {
  return useContext(World);
}

export function useSiteTypes() {
  return useContext(Types);
}
