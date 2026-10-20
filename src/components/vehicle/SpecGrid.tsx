import { registrationLabel } from "@/lib/vehicle-categories";
import type { Vehicle } from "@/types/vehicle";
import { formatKm, formatNumber } from "@/lib/format";

/**
 * Características essenciais da viatura. No telemóvel, grelha de duas colunas
 * (ícone + valor em destaque + rótulo); no computador, cartão "Características"
 * com uma linha por item, ao lado da galeria.
 * Server Component (sem interatividade).
 */
export function SpecGrid({ vehicle }: { vehicle: Vehicle }) {
  const items: { icon: React.ReactNode; value: string; label: string }[] = [
    {
      icon: <CalendarIcon />,
      value: registrationLabel(vehicle.year, vehicle.registrationMonth),
      label: "Primeira matrícula",
    },
    {
      icon: <GaugeIcon />,
      value: formatKm(vehicle.mileage),
      label: "Quilómetros",
    },
    { icon: <FuelIcon />, value: vehicle.fuel, label: "Combustível" },
    { icon: <GearIcon />, value: vehicle.transmission, label: "Transmissão" },
  ];
  if (vehicle.displacement > 0)
    items.push({
      icon: <EngineIcon />,
      value: `${formatNumber(vehicle.displacement)} cm³`,
      label: "Cilindrada",
    });
  if (vehicle.power > 0)
    items.push({
      icon: <PowerIcon />,
      value: `${vehicle.power} cv`,
      label: "Potência",
    });
  if (vehicle.color)
    items.push({ icon: <PaletteIcon />, value: vehicle.color, label: "Cor" });
  items.push({
    icon: <FlagIcon />,
    value: vehicle.national ? "Nacional" : "Importado",
    label: "Origem",
  });
  items.push({ icon: <CarIcon />, value: vehicle.body, label: "Segmento" });
  // Lugares, portas e o resto ficam na ficha técnica, mais abaixo: aqui só o
  // essencial, para o cartão caber ao lado da foto.

  return (
    <section
      aria-labelledby="caracteristicas"
      className="xl:rounded-3xl xl:bg-ink-soft xl:p-5"
    >
      <h2
        id="caracteristicas"
        className="sr-only xl:not-sr-only xl:mb-2 xl:block xl:text-lg xl:font-semibold xl:text-paper"
      >
        Características
      </h2>

      {/* Telemóvel: grelha de duas colunas, o valor em destaque. */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 xl:hidden">
        {items.map((it) => (
          <div key={it.label} className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/5 text-paper/80">
              {it.icon}
            </span>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-paper">
                {it.value}
              </p>
              <p className="text-xs text-paper/50">{it.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Computador: lista compacta (ícone e rótulo à esquerda, valor à
          direita), para caber ao lado da foto. */}
      <dl className="hidden xl:block">
        {items.map((it) => (
          <div
            key={it.label}
            className="flex items-center justify-between gap-4 py-1"
          >
            <dt className="flex min-w-0 items-center gap-2.5 text-sm text-paper/65 [&_svg]:h-[18px] [&_svg]:w-[18px]">
              <span className="shrink-0 text-paper/80">{it.icon}</span>
              {it.label}
            </dt>
            <dd className="truncate text-right text-sm font-semibold text-paper">
              {it.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* --- ícones (traço fino, herdam currentColor) ------------------------------ */
const s = {
  className: "h-5 w-5",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
  "aria-hidden": true,
};

function CalendarIcon() {
  return (
    <svg {...s}>
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v3M16 3v3" />
    </svg>
  );
}
function GaugeIcon() {
  return (
    <svg {...s}>
      <path d="M12 13l4-3" />
      <path d="M4 18a8 8 0 1116 0" />
      <circle cx="12" cy="13" r="1" />
    </svg>
  );
}
function FuelIcon() {
  return (
    <svg {...s}>
      <path d="M5 21V5a2 2 0 012-2h6a2 2 0 012 2v16H5z" />
      <path d="M15 8h2.5A1.5 1.5 0 0119 9.5V16a1.5 1.5 0 003 0V9l-3-3" />
      <path d="M7 9h6" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg {...s}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
    </svg>
  );
}
function EngineIcon() {
  return (
    <svg {...s}>
      <path d="M6 9v6M3 11v2M9 9h4l3 3h3v4h-2l-2 2H9a3 3 0 01-3-3" />
      <path d="M13 9V6h3" />
    </svg>
  );
}
function PowerIcon() {
  return (
    <svg {...s}>
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  );
}
function PaletteIcon() {
  return (
    <svg {...s}>
      <path d="M12 3a9 9 0 100 18h1.5a2 2 0 001.9-2.6 2 2 0 011.9-2.6H19a3 3 0 003-3A9 9 0 0012 3z" />
      <circle cx="7.5" cy="11" r="1" />
      <circle cx="12" cy="7.5" r="1" />
      <circle cx="16.5" cy="11" r="1" />
    </svg>
  );
}
function FlagIcon() {
  return (
    <svg {...s}>
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </svg>
  );
}
function CarIcon() {
  return (
    <svg {...s}>
      <path d="M3 13l2-5a2 2 0 012-1.5h10A2 2 0 0119 8l2 5v5h-3M6 18H3v-5M6 18a1.5 1.5 0 003 0M15 18a1.5 1.5 0 003 0M6 18h9M3 13h18" />
    </svg>
  );
}
