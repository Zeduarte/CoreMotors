import { registrationLabel } from "@/lib/vehicle-categories";
import type { Vehicle } from "@/types/vehicle";
import { formatKm, formatNumber } from "@/lib/format";
import { Reveal } from "@/components/ui/Reveal";

/** Ficha técnica completa em grelha. Server Component (sem interatividade). */
export function Specs({ vehicle }: { vehicle: Vehicle }) {
  const rows: Array<{ label: string; value: string }> = [
    { label: "Marca", value: vehicle.make },
    { label: "Modelo", value: vehicle.model },
    ...(vehicle.variant ? [{ label: "Versão", value: vehicle.variant }] : []),
    {
      label: "Primeira matrícula",
      value: registrationLabel(vehicle.year, vehicle.registrationMonth),
    },
    { label: "Quilómetros", value: formatKm(vehicle.mileage) },
    { label: "Combustível", value: vehicle.fuel },
    { label: "Caixa", value: vehicle.transmission },
    { label: "Carroçaria", value: vehicle.body },
    // Só o que o vendedor indicou: um zero aqui não é "zero cavalos", é um
    // campo em branco — mostrá-lo seria informação falsa no anúncio.
    ...(vehicle.power > 0
      ? [{ label: "Potência", value: `${vehicle.power} cv` }]
      : []),
    ...(vehicle.displacement > 0
      ? [
          {
            label: "Cilindrada",
            value: `${formatNumber(vehicle.displacement)} cm³`,
          },
        ]
      : []),
    ...(vehicle.color ? [{ label: "Cor", value: vehicle.color }] : []),
    ...(vehicle.doors > 0
      ? [{ label: "Portas", value: String(vehicle.doors) }]
      : []),
    { label: "Lugares", value: String(vehicle.seats) },
  ];

  return (
    <section aria-labelledby="specs-title">
      {/* O separador "Ficha técnica" já dá o título à vista. */}
      <h2 id="specs-title" className="sr-only">
        Ficha técnica
      </h2>
      <Reveal
        stagger={0.04}
        y={16}
        childSelector="[data-spec]"
        className="grid grid-cols-1 gap-x-10 sm:grid-cols-2 xl:grid-cols-3"
      >
        {rows.map((r) => (
          <div
            key={r.label}
            data-spec
            className="flex items-center justify-between border-b border-white/10 py-3.5"
          >
            <dt className="text-sm text-paper/50">{r.label}</dt>
            <dd className="text-sm font-medium text-paper">{r.value}</dd>
          </div>
        ))}
      </Reveal>
    </section>
  );
}
