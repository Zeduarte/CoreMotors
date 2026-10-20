"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { VehicleType } from "@/lib/vehicle-categories";
import { useWorldChosen } from "./VehicleWorld";

/**
 * Quem chega a uma viatura sem nunca ter escolhido carros ou motas entra no
 * mundo dessa viatura — o ecrã de escolha é só para quem abre a página inicial.
 * Quem já escolheu mantém a sua escolha.
 */
export function VehicleWorldSync({ type }: { type: VehicleType }) {
  const chosen = useWorldChosen();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (chosen) return;
    fetch(`/api/vehicle-context?type=${type}&area=public&target=${encodeURIComponent(pathname)}`, {
      redirect: "manual",
      credentials: "same-origin",
    })
      .then(() => router.refresh())
      .catch(() => {});
    // Só à chegada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
