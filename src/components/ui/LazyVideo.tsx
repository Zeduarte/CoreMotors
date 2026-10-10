"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Vídeo de fundo (mudo, em loop) que só começa a descarregar quando está perto
 * do ecrã. Um vídeo a meio da página não deve competir com o topo — alguns têm
 * vários MB e atrasavam a primeira visita, sobretudo em rede móvel.
 */
export function LazyVideo({
  src,
  poster,
  className,
}: {
  src: string;
  poster?: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <video
      ref={ref}
      className={className}
      src={near ? src : undefined}
      autoPlay={near}
      muted
      loop
      playsInline
      preload="none"
      poster={poster}
    />
  );
}
