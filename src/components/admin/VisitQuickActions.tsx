"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { quickAssign } from "@/lib/actions/lead-quick";

const BTN =
  "inline-flex items-center rounded-full border border-white/15 px-4 py-2 text-sm text-paper/80 transition-colors hover:border-accent hover:text-accent disabled:opacity-50";

/**
 * Ações rápidas de uma visita na agenda que não existem como formulário:
 * ligar, ficar com a visita ou passá-la a alguém, e abrir o contacto. Confirmar,
 * WhatsApp e o resultado da visita continuam como estavam.
 */
export function VisitQuickActions({
  id,
  phone,
  assignedTo,
  staff,
  meId,
}: {
  id: string;
  phone: string | null;
  assignedTo: string | null;
  staff: { id: string; name: string }[];
  meId: string;
}) {
  const [pending, start] = useTransition();

  function assign(to: string, success: string) {
    start(async () => {
      try {
        const res = await quickAssign(id, to);
        if (res.ok) toast.success(success);
        else toast.error(res.error ?? "Não foi possível atribuir.");
      } catch {
        toast.error("Falha de ligação. Tente novamente.");
      }
    });
  }

  return (
    <>
      {phone && (
        <a href={`tel:${phone}`} className={BTN}>
          Ligar
        </a>
      )}
      {assignedTo !== meId && (
        <button type="button" disabled={pending} onClick={() => assign(meId, "Atribuído a si.")} className={BTN}>
          Atribuir-me
        </button>
      )}
      {staff.length > 0 && (
        <select
          aria-label="Atribuir a"
          disabled={pending}
          value={assignedTo ?? ""}
          onChange={(e) => assign(e.target.value, "Responsável atualizado.")}
          className="rounded-full border border-white/15 bg-transparent px-3 py-2 text-sm text-paper/80"
        >
          <option value="">Por atribuir</option>
          {staff.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <Link href={`/admin/leads/${id}`} className="px-1 text-sm font-medium text-accent hover:underline">
        Abrir →
      </Link>
    </>
  );
}
