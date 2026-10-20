"use client";

import { createContext, useContext } from "react";
import type { VehicleType } from "@/lib/vehicle-categories";

const World = createContext<VehicleType>("car");
// O visitante já escolheu um mundo (cookie), ou ainda é o "carros" por defeito?
const Chosen = createContext(false);

export function VehicleWorld({
  type,
  chosen = false,
  children,
}: {
  type: VehicleType;
  chosen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <World.Provider value={type}>
      <Chosen.Provider value={chosen}>{children}</Chosen.Provider>
    </World.Provider>
  );
}

export function useVehicleWorld() {
  return useContext(World);
}

export function useWorldChosen() {
  return useContext(Chosen);
}
