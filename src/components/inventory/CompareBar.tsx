"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useCompare } from "./CompareContext";

/**
 * Barra flutuante que aparece quando há viaturas selecionadas para comparar.
 * Liga à página /comparar com os slugs no URL.
 */
export function CompareBar() {
  const { slugs, clear } = useCompare();

  return (
    <AnimatePresence>
      {slugs.length > 0 && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="compare-bar fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 [view-transition-name:compare-bar]"
        >
          <div className="flex items-center gap-4 rounded-full border border-white/10 bg-ink-soft/95 px-5 py-3 shadow-xl shadow-black/40 backdrop-blur">
            <span className="text-sm text-paper">
              <span className="font-semibold text-accent">{slugs.length}</span> a
              comparar
            </span>
            <Link
              href={`/comparar?ids=${slugs.join(",")}`}
              className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-ink transition-transform hover:scale-[1.03]"
            >
              Comparar
            </Link>
            <button
              type="button"
              onClick={clear}
              className="text-xs text-paper/50 transition-colors hover:text-paper"
            >
              Limpar
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
