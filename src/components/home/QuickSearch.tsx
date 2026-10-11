"use client";

import { useMemo, useState } from "react";
import { brandOptions, sameBrand } from "@/lib/brand-name";
import { useRouter } from "next/navigation";

type Item = { make: string; model: string; fuel: string; transmission: string };

/**
 * Pesquisa rápida da homepage — uma barra compacta na cor da marca com Marca,
 * Modelo, Combustível e Transmissão lado a lado e o botão «Procurar» à
 * direita. No telemóvel não há cartão: só os campos têm fundo, numa grelha de
 * 2×2, com o botão por baixo — vê-se mais a imagem do topo. Leva ao stock já
 * filtrado.
 */
export function QuickSearch({ vehicles }: { vehicles: Item[] }) {
  const router = useRouter();
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [fuel, setFuel] = useState("");
  const [transmission, setTransmission] = useState("");

  const makes = useMemo(
    () =>
      // Agrupado sem olhar a maiúsculas, senão "BMW" e "Bmw" apareciam como
      // duas marcas ao visitante.
      brandOptions(vehicles.map((v) => v.make)),
    [vehicles],
  );
  const models = useMemo(
    () =>
      make
        ? distinct(vehicles.filter((v) => sameBrand(v.make, make)).map((v) => v.model))
        : [],
    [vehicles, make],
  );
  // Combustível e caixa acompanham a marca/modelo escolhidos: só se mostram
  // opções que dão resultados.
  const scoped = useMemo(
    () =>
      vehicles.filter(
        (v) => (!make || sameBrand(v.make, make)) && (!model || v.model === model),
      ),
    [vehicles, make, model],
  );
  const fuels = useMemo(() => distinct(scoped.map((v) => v.fuel)), [scoped]);
  const transmissions = useMemo(
    () => distinct(scoped.map((v) => v.transmission)),
    [scoped],
  );
  // Uma escolha que deixou de existir ao mudar a marca/modelo conta como «qualquer».
  const fuelValue = fuels.includes(fuel) ? fuel : "";
  const transmissionValue = transmissions.includes(transmission) ? transmission : "";

  function search() {
    const params = new URLSearchParams();
    if (make) params.set("make", make);
    if (model) params.set("model", model);
    if (fuelValue) params.set("fuel", fuelValue);
    if (transmissionValue) params.set("transmission", transmissionValue);
    const qs = params.toString();
    router.push(qs ? `/inventario?${qs}` : "/inventario");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        search();
      }}
      className="text-ink md:rounded-xl md:bg-accent md:p-2 md:shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)]"
    >
      <div className="flex flex-col md:flex-row md:items-center md:gap-2">
        <div className="grid flex-1 grid-cols-2 gap-2 md:grid-cols-4 md:gap-0 md:divide-x md:divide-ink/15">
          <Select
            label="Marca"
            value={make}
            onChange={(v) => {
              setMake(v);
              setModel("");
            }}
            options={makes}
          />
          <Select
            label="Modelo"
            value={model}
            disabled={!make}
            onChange={setModel}
            options={models}
          />
          <Select label="Combustível" value={fuelValue} onChange={setFuel} options={fuels} />
          <Select
            label="Transmissão"
            value={transmissionValue}
            onChange={setTransmission}
            options={transmissions}
          />
        </div>

        <button
          type="submit"
          className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-paper px-6 py-3 text-sm font-semibold text-ink shadow-lg transition-[transform,background-color] hover:scale-[1.02] hover:bg-white active:scale-[0.98] md:mt-0 md:w-36 md:shrink-0 md:rounded-lg md:py-2.5 md:shadow-none"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          Procurar
        </button>
      </div>

      <style>{`
        .qs-select {
          width: 100%;
          border: 0;
          border-radius: 0;
          background-color: transparent;
          padding: 0.7rem 2rem 0.7rem 0.9rem;
          font-size: 1rem; /* ≥16px evita zoom automático no iOS */
          font-weight: 600;
          color: inherit;
          cursor: pointer;
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%230A0A0A' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 0.7rem center;
        }
        @media (min-width: 768px) {
          .qs-select { padding: 0.5rem 2.25rem 0.5rem 1rem; font-size: 0.9rem; background-position: right 0.85rem center; }
        }
        .qs-select:focus { outline: none; }
        .qs-select:focus-visible { outline: 2px solid currentColor; outline-offset: -2px; border-radius: 0.375rem; }
        .qs-select:disabled { opacity: 0.45; cursor: not-allowed; }
        /* As opções abrem no menu nativo do SO — força texto escuro legível. */
        .qs-select option { color: #18181b; font-weight: 400; }
      `}</style>
    </form>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  disabled?: boolean;
}) {
  return (
    // Telemóvel: cada campo tem o seu fundo; no computador partilham a barra.
    <label className="block min-w-0 rounded-xl bg-accent shadow-lg md:rounded-none md:bg-transparent md:shadow-none">
      <span className="sr-only">{label}</span>
      <select
        className="qs-select truncate"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {/* O nome do campo é a 1.ª opção, como na barra de referência: vazio
            = qualquer. */}
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function distinct(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt"));
}
