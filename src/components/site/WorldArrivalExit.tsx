"use client";

import { useEffect } from "react";
import {
  ARRIVAL_KEY,
  completeWorldProgress,
  readWorldArrival,
  simulatedProgress,
} from "@/lib/world-arrival";

/** Tempo para o anel chegar aos 100% antes de a capa sair. */
const COMPLETE_MS = 250;

/** Tira a capa de chegada (ver `WorldArrival`) com a animação de saída. */
export function WorldArrivalExit() {
  useEffect(() => {
    const arrival = readWorldArrival();
    try {
      sessionStorage.removeItem(ARRIVAL_KEY);
    } catch {
      // sem sessionStorage não houve capa
    }
    const cover = document.getElementById("world-arrival");
    if (!cover?.hasAttribute("data-show")) return;
    // A página nova está pronta: o anel acaba nos 100% e a capa sai.
    cover.setAttribute("data-complete", "");
    completeWorldProgress(cover, arrival ? simulatedProgress(Date.now() - arrival.t) : 0, COMPLETE_MS);
    const leave = setTimeout(() => cover.setAttribute("data-leave", ""), COMPLETE_MS + 50);
    const done = setTimeout(() => cover.setAttribute("data-done", ""), COMPLETE_MS + 50 + 780);
    return () => {
      clearTimeout(leave);
      clearTimeout(done);
    };
  }, []);
  return null;
}
