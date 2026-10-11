import type { VehicleType } from "@/lib/vehicle-categories";

/**
 * Sinal entre a página antiga e a nova numa troca de mundo (carros ↔ motas).
 *
 * A troca é uma navegação completa (a rota grava o cookie e redireciona), por
 * isso a animação passa de uma página para a outra por sessionStorage: a antiga
 * marca a chegada e a nova, ao abrir, começa tapada pela mesma imagem e
 * revela-se. A marca expira depressa para nunca tapar uma visita mais tarde.
 */
export const ARRIVAL_KEY = "world-arrival";
export const ARRIVAL_TTL_MS = 20_000;

/** `t`: quando o visitante escolheu — o progresso conta a partir daí. */
export function markWorldArrival(type: VehicleType, t = Date.now()) {
  try {
    sessionStorage.setItem(ARRIVAL_KEY, JSON.stringify({ type, t }));
  } catch {
    // sessionStorage bloqueado: a página nova abre sem a revelação
  }
}

/** Lê a marca de chegada (ou `null`). */
export function readWorldArrival(): { type: VehicleType; t: number } | null {
  try {
    return JSON.parse(sessionStorage.getItem(ARRIVAL_KEY) || "null");
  } catch {
    return null;
  }
}

/*
 * Progresso da troca. Numa navegação completa o browser não diz quanto falta,
 * por isso a percentagem é estimada: sobe depressa no início e abranda à
 * espera da página nova, sem passar dos 90%. A página nova continua a contagem
 * a partir da mesma hora (`t` da marca) e só ela a leva aos 100%.
 */
export const PROGRESS_MAX = 90;
export const PROGRESS_TAU_MS = 1600;

export function simulatedProgress(elapsedMs: number): number {
  return PROGRESS_MAX * (1 - Math.exp(-Math.max(0, elapsedMs) / PROGRESS_TAU_MS));
}

/** Desenha `p` (0–100) no anel `WorldProgress` dentro de `root`. */
export function setWorldProgress(root: ParentNode | null | undefined, p: number) {
  const ring = root?.querySelector("[data-world-progress]");
  if (!ring) return;
  const bar = ring.querySelector<SVGElement>("[data-bar]");
  const pct = ring.querySelector("[data-pct]");
  if (bar) bar.style.strokeDashoffset = String(100 - p);
  if (pct) pct.textContent = `${Math.round(p)}%`;
}

/** Faz o anel andar desde `since` até se chamar a função devolvida. */
export function runWorldProgress(root: ParentNode | null | undefined, since: number): () => void {
  let frame = 0;
  const tick = () => {
    setWorldProgress(root, simulatedProgress(Date.now() - since));
    frame = requestAnimationFrame(tick);
  };
  tick();
  return () => cancelAnimationFrame(frame);
}

/** Leva o anel de `from` aos 100% em `ms`. */
export function completeWorldProgress(root: ParentNode | null | undefined, from: number, ms: number) {
  const start = performance.now();
  const tick = (now: number) => {
    const k = Math.min(1, (now - start) / ms);
    setWorldProgress(root, from + (100 - from) * k);
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
