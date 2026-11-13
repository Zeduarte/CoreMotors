"use client";

import Link from "next/link";
import { useCompareIfAny } from "./CompareContext";

/**
 * «Tirar» uma viatura da comparação: abre a mesma página sem ela e tira-a da
 * lista guardada no browser (a barra «N a comparar» acompanha).
 */
export function CompareRemove({ slug, rest }: { slug: string; rest: string[] }) {
  const compare = useCompareIfAny();
  return (
    <Link
      href={rest.length ? `/comparar?ids=${rest.join(",")}` : "/comparar"}
      replace
      scroll={false}
      onClick={() => compare?.remove(slug)}
      aria-label="Tirar da comparação"
      className="mt-2 inline-block text-xs text-paper/50 transition-colors hover:text-accent"
    >
      Tirar ✕
    </Link>
  );
}
