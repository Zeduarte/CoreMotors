import type { VehicleType } from "@/lib/vehicle-categories";
import { ARRIVAL_KEY, ARRIVAL_TTL_MS, PROGRESS_MAX, PROGRESS_TAU_MS } from "@/lib/world-arrival";
import { WorldCoverArt, worldCoverStyles as styles } from "./WorldCover";
import { WorldArrivalExit } from "./WorldArrivalExit";

/**
 * Segunda metade da troca de mundo: a página nova abre tapada pela imagem do
 * mundo escolhido, que depois sai para o lado.
 *
 * Tem de tapar ANTES do primeiro desenho, senão a página nova piscava antes da
 * animação. Por isso a capa vem no HTML (escondida) e um script, logo a seguir,
 * mostra-a se a página anterior marcou a chegada e continua o anel de
 * progresso (mesma conta de `simulatedProgress`). O React só trata da saída.
 */
export function WorldArrival({ type }: { type: VehicleType }) {
  const reveal = `(function(){try{var e=document.getElementById("world-arrival");var a=JSON.parse(sessionStorage.getItem(${JSON.stringify(ARRIVAL_KEY)})||"null");if(e&&a&&a.type===e.getAttribute("data-world")&&Date.now()-a.t<${ARRIVAL_TTL_MS}&&!window.matchMedia("(prefers-reduced-motion: reduce)").matches){e.setAttribute("data-show","");var i=e.querySelector("img");if(i)i.loading="eager";var b=e.querySelector("[data-bar]"),c=e.querySelector("[data-pct]");(function f(){if(e.hasAttribute("data-complete"))return;var p=${PROGRESS_MAX}*(1-Math.exp(-Math.max(0,Date.now()-a.t)/${PROGRESS_TAU_MS}));if(b)b.style.strokeDashoffset=String(100-p);if(c)c.textContent=Math.round(p)+"%";requestAnimationFrame(f)})()}}catch(_){}})();`;
  return (
    <>
      <div
        id="world-arrival"
        data-world={type}
        className={`${styles.overlay} ${styles.arrival}`}
        aria-hidden
        suppressHydrationWarning
      >
        <WorldCoverArt type={type} lazy />
      </div>
      <script dangerouslySetInnerHTML={{ __html: reveal }} />
      <WorldArrivalExit />
    </>
  );
}
