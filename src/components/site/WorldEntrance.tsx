"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { usePathname } from "next/navigation";
import type { VehicleType } from "@/lib/vehicle-categories";
import { asset } from "@/lib/asset";
import { mediaFor } from "@/lib/media";
import { markWorldArrival, runWorldProgress } from "@/lib/world-arrival";
import { WorldProgress } from "./WorldProgress";
import styles from "./WorldEntrance.module.css";

/** First visit selects the persistent public vehicle category. */
export function WorldEntrance({ name, selected }: { name: string; selected: VehicleType | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Página onde o visitante entrou. Sem isto a rota devolvia toda a gente à
  // homepage, e quem chegasse de um link partilhado (OLX, Google, WhatsApp)
  // perdia a viatura que foi ver.
  const pathname = usePathname();
  const [entered, setEntered] = useState(Boolean(selected));
  const [leaving, setLeaving] = useState<string | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exiting = useRef(false);
  const departure = useRef<HTMLDivElement>(null);
  const startedAt = useRef(0);

  useEffect(() => () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
  }, []);

  // Voltar atrás para esta página (cache do browser) depois de escolher: o
  // ecrã de partida ficava parado. Recarrega — o cookie já tem a escolha.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted && exiting.current) window.location.reload();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  // Anel de progresso no ecrã de partida, desde o clique até a página mudar.
  useEffect(() => {
    if (!leaving) return;
    return runWorldProgress(departure.current, startedAt.current);
  }, [leaving]);

  function move(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    event.currentTarget.style.setProperty("--pan-x", `${(x - .5) * 22}px`);
    event.currentTarget.style.setProperty("--pan-y", `${(y - .5) * 16}px`);
    event.currentTarget.style.setProperty("--light-x", `${x * 100}%`);
    event.currentTarget.style.setProperty("--light-y", `${y * 100}%`);
  }

  function reset(event: PointerEvent<HTMLButtonElement>) {
    event.currentTarget.style.setProperty("--pan-x", "0px");
    event.currentTarget.style.setProperty("--pan-y", "0px");
  }

  function letters(word: string) {
    return [...word].map((letter, index) => (
      <span key={index} style={{ "--letter": index } as CSSProperties}>{letter}</span>
    ));
  }

  useEffect(() => {
    if (entered) return;
    const element = dialog.current;
    // Vem aberto do servidor (ver `open` abaixo) para tapar a página desde o
    // 1.º desenho; aqui passa a modal (foco preso, resto da página inerte).
    if (element?.open) element.close();
    element?.showModal();
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      element?.close();
      document.documentElement.style.overflow = previous;
    };
  }, [entered]);

  function enter(type: VehicleType, choice = "A tua próxima viagem") {
    if (exiting.current) return;
    exiting.current = true;
    startedAt.current = Date.now();
    // O ecrã NÃO se fecha antes de sair: fechá-lo destapava a página que está
    // por baixo (a dos carros, a escolha por defeito) enquanto o servidor
    // prepara a escolhida. Fica aberto até o browser trocar de página, e a
    // página nova abre tapada pela capa do mundo escolhido (WorldArrival).
    const finish = () => {
      markWorldArrival(type, startedAt.current);
      window.location.assign(
        `/api/vehicle-context?type=${type}&area=public&target=${encodeURIComponent(pathname)}`,
      );
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    setLeaving(choice);
    // O pedido começa enquanto o ecrã de partida ainda anima: a espera pelo
    // servidor fica escondida atrás dele em vez de se somar à animação.
    exitTimer.current = setTimeout(finish, 600);
  }

  if (entered) return null;

  return (
    // `open` desde o servidor: tapa a página antes de o JavaScript carregar.
    <dialog ref={dialog} open className={styles.entrance} data-leaving={leaving ? "true" : undefined} aria-labelledby="world-title"
      data-lenis-prevent onCancel={(event) => { event.preventDefault(); }}>
      <header className={styles.header}>
        <span className={styles.brand}>{name}<span className={styles.brandDot}>.</span></span>
        <span className={styles.edition}>DUAS FORMAS DE SENTIR A ESTRADA</span>
        <span className={styles.skip}>Escolhe carros ou motas</span>
      </header>

      <div className={styles.heading}>
        <p>O DESTINO É TEU.</p>
        <h1 id="world-title">Escolhe a tua <em>liberdade.</em></h1>
      </div>

      <div className={styles.worlds}>
        <span className={styles.opening} aria-hidden />
        <button className={`${styles.world} ${styles.moto}`} onPointerMove={move} onPointerLeave={reset} onClick={() => enter("motorcycle", "Liberdade sobre duas rodas")} aria-label="Escolher motas e entrar no site">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset(mediaFor("motorcycle").entrada)} alt="" fetchPriority="high" className={styles.photo} />
          <span className={styles.shade} />
          <span className={styles.light} aria-hidden />
          <span className={styles.speedLines} aria-hidden><i /><i /><i /></span>
          <span className={styles.number} aria-hidden>01 / TWO WHEELS</span>
          <span className={styles.copy}>
            <span className={styles.kicker}>INSTINTO SEM FILTROS</span>
            <span className={styles.title}>{letters("MOTAS")}<span className={styles.dot}>.</span></span>
            <span className={styles.description}>Menos limites. Mais estrada.</span>
            <span className={styles.cta}>Explorar motas <span className={styles.arrow} aria-hidden>↗</span></span>
          </span>
        </button>
        <span className={styles.divider} aria-hidden><span>&</span></span>
        <button className={`${styles.world} ${styles.car}`} onPointerMove={move} onPointerLeave={reset} onClick={() => enter("car", "Paixão em quatro rodas")} aria-label="Escolher carros e entrar no site">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset(mediaFor("car").entrada)} alt="" fetchPriority="high" className={styles.photo} />
          <span className={styles.shade} />
          <span className={styles.light} aria-hidden />
          <span className={styles.speedLines} aria-hidden><i /><i /><i /></span>
          <span className={styles.number} aria-hidden>02 / FOUR WHEELS</span>
          <span className={styles.copy}>
            <span className={styles.kicker}>PAIXÃO EM CADA CURVA</span>
            <span className={styles.title}>{letters("CARROS")}<span className={styles.dot}>.</span></span>
            <span className={styles.description}>A tua próxima grande viagem.</span>
            <span className={styles.cta}>Explorar carros <span className={styles.arrow} aria-hidden>↗</span></span>
          </span>
        </button>
      </div>
      {leaving && <div ref={departure} className={styles.departure} role="status">
        <span className={styles.departureLine} />
        <p>VAMOS A ISSO.</p><strong>{leaving}<span>.</span></strong>
        <span className={styles.departureArrow} aria-hidden>↗</span>
        <WorldProgress className={styles.departureProgress} />
      </div>}
      <footer className={styles.footer}><span>UMA PAIXÃO. DOIS UNIVERSOS.</span><span>O próximo capítulo começa aqui <span aria-hidden>↗</span></span></footer>
    </dialog>
  );
}
