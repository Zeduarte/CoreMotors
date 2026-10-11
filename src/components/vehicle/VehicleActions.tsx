"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { OfferForm } from "./OfferForm";
import { InfoForm } from "./InfoForm";
import { TestDriveForm } from "./TestDriveForm";
import { ReserveForm } from "./ReserveForm";
import { VEHICLE_CONTACT_EVENT, type VehicleContactDetail } from "@/lib/vehicle-contact";

type Mode = "offer" | "info" | "testdrive" | "reserve";

/**
 * Painel de ações da ficha de viatura: um único ponto de contacto, com o
 * pedido de informações já aberto (é o que a maioria quer) e separadores para
 * proposta, test drive e reserva. Antes era preciso escolher num menu e só
 * depois aparecia o formulário — um clique a mais que fazia desistir.
 */
export function VehicleActions({
  vehicleName,
  vehicleId,
  price,
  canReserve,
  depositAmount,
}: {
  vehicleName: string;
  vehicleId?: string;
  price?: number | null;
  canReserve: boolean;
  depositAmount: number;
}) {
  const [mode, setMode] = useState<Mode>("info");
  // Mensagem vinda do contacto rápido (ex.: "Ainda está disponível?").
  const [message, setMessage] = useState<{ text: string; n: number } | null>(null);
  const box = useRef<HTMLElement>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const el = box.current;
      // Há um painel em mobile e outro no desktop: só o visível responde.
      if (!el || el.offsetParent === null) return;
      const { message: text } = (e as CustomEvent<VehicleContactDetail>).detail;
      setMode("info");
      setMessage((m) => ({ text, n: (m?.n ?? 0) + 1 }));
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => el.querySelector<HTMLInputElement>("input[name=name]")?.focus({ preventScroll: true }), 500);
    };
    window.addEventListener(VEHICLE_CONTACT_EVENT, onOpen);
    return () => window.removeEventListener(VEHICLE_CONTACT_EVENT, onOpen);
  }, []);

  const actions: { id: Mode; label: string }[] = [
    { id: "info", label: "Informações" },
    { id: "offer", label: "Proposta" },
    { id: "testdrive", label: "Test drive" },
    ...(canReserve ? [{ id: "reserve" as Mode, label: "Reservar" }] : []),
  ];
  const titles: Record<Mode, string> = {
    offer: "Fazer uma proposta",
    info: "Pedir mais informações",
    testdrive: "Marcar test drive",
    reserve: "Reservar viatura",
  };

  return (
    // `data-chat-target` — o assistente virtual rola até aqui quando encaminha.
    <section
      ref={box}
      data-chat-target="interessado"
      className="scroll-mt-28 rounded-3xl border border-white/10 bg-ink-soft p-6 md:p-8"
    >
      <h2 className="text-2xl font-semibold text-paper">Interessado?</h2>
      <p className="mt-1 text-sm text-paper/50">
        Deixe o seu contacto e falamos consigo sobre o {vehicleName}, sem compromisso.
      </p>

      {/* Separadores: o que quer fazer. */}
      <div role="tablist" aria-label="O que pretende" className="mt-5 flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={mode === a.id}
            onClick={() => setMode(a.id)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              mode === a.id
                ? "bg-accent text-ink"
                : "border border-white/15 text-paper/80 hover:border-accent hover:text-accent"
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={mode}
          role="tabpanel"
          aria-label={titles[mode]}
          className="mt-6"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
        >
          {mode === "offer" && (
            <OfferForm vehicleName={vehicleName} vehicleId={vehicleId} price={price} />
          )}
          {mode === "info" && (
            <InfoForm
              key={message?.n ?? 0}
              vehicleName={vehicleName}
              vehicleId={vehicleId}
              initialMessage={message?.text}
            />
          )}
          {mode === "testdrive" && (
            <TestDriveForm vehicleName={vehicleName} vehicleId={vehicleId} bare />
          )}
          {mode === "reserve" && (
            <ReserveForm
              vehicleName={vehicleName}
              vehicleId={vehicleId}
              depositAmount={depositAmount}
              bare
            />
          )}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}
