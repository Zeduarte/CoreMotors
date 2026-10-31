/**
 * Horas de trabalho de uma pessoa: as das viaturas (registadas na Oficina ou
 * pelo WhatsApp, em `vehicle_tasks`) e as outras tarefas (`time_entries`),
 * juntas numa só lista. Funções puras.
 */

export interface VehicleHoursRow {
  id: string;
  car_id: string;
  work_date: string;
  start_time: string;
  end_time: string | null;
  hours: number | string;
  description: string | null;
  created_by: string | null;
  /** Nome de quem registou, guardado quando o utilizador foi apagado. */
  created_by_name?: string | null;
  car?: { make: string; model: string; license_plate: string | null } | null;
}

export interface OtherHoursRow {
  id: string;
  /** null quando o utilizador foi apagado (o nome fica em `profile_name`). */
  profile_id: string | null;
  profile_name?: string | null;
  work_date: string;
  start_time: string;
  end_time: string | null;
  hours: number | string;
  description: string;
}

export interface HoursEntry {
  id: string;
  kind: "vehicle" | "other";
  personId: string | null;
  /** Só quando a pessoa já foi apagada: o nome que ficou guardado. */
  personName?: string | null;
  date: string;
  start: string;
  end: string | null;
  hours: number;
  description: string;
  /** Só nas horas de viatura: para ligar à página da viatura na Oficina. */
  vehicle?: { id: string; label: string };
}

const hm = (t: string | null) => (t ? t.slice(0, 5) : null);

export function vehicleLabel(car: VehicleHoursRow["car"]): string {
  if (!car) return "Viatura";
  const nome = [car.make, car.model !== "—" ? car.model : ""].filter(Boolean).join(" ");
  return car.license_plate ? `${nome} · ${car.license_plate}` : nome;
}

/** Junta as duas origens, da mais recente para a mais antiga. */
export function mergeHours(vehicle: VehicleHoursRow[], other: OtherHoursRow[]): HoursEntry[] {
  const entries: HoursEntry[] = [
    ...vehicle.map((v) => ({
      id: v.id,
      kind: "vehicle" as const,
      personId: v.created_by,
      personName: v.created_by ? null : v.created_by_name ?? null,
      date: v.work_date,
      start: hm(v.start_time)!,
      end: hm(v.end_time),
      hours: Number(v.hours) || 0,
      description: v.description?.trim() || "Trabalho na viatura",
      vehicle: { id: v.car_id, label: vehicleLabel(v.car) },
    })),
    ...other.map((o) => ({
      id: o.id,
      kind: "other" as const,
      personId: o.profile_id,
      personName: o.profile_id ? null : o.profile_name ?? null,
      date: o.work_date,
      start: hm(o.start_time)!,
      end: hm(o.end_time),
      hours: Number(o.hours) || 0,
      description: o.description,
    })),
  ];
  return entries.sort((a, b) => (a.date === b.date ? b.start.localeCompare(a.start) : b.date.localeCompare(a.date)));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface HoursSummary {
  total: number;
  vehicle: number;
  other: number;
  /** Registos ainda sem hora de fim (turno em aberto). */
  open: number;
  byPerson: { personId: string | null; total: number; vehicle: number; other: number }[];
}

export function summarizeHours(entries: HoursEntry[]): HoursSummary {
  const people = new Map<string | null, { total: number; vehicle: number; other: number }>();
  let vehicle = 0;
  let other = 0;
  let open = 0;
  for (const e of entries) {
    if (!e.end) open += 1;
    if (e.kind === "vehicle") vehicle += e.hours;
    else other += e.hours;
    const p = people.get(e.personId) ?? { total: 0, vehicle: 0, other: 0 };
    p.total += e.hours;
    p[e.kind === "vehicle" ? "vehicle" : "other"] += e.hours;
    people.set(e.personId, p);
  }
  return {
    total: round2(vehicle + other),
    vehicle: round2(vehicle),
    other: round2(other),
    open,
    byPerson: [...people.entries()]
      .map(([personId, p]) => ({ personId, total: round2(p.total), vehicle: round2(p.vehicle), other: round2(p.other) }))
      .sort((a, b) => b.total - a.total),
  };
}

/** "2026-09" válido → primeiro e último dia; inválido → o mês de `today`. */
export function monthRange(param: string | undefined, today: string): { month: string; from: string; to: string; prev: string; next: string } {
  const month = param && /^\d{4}-(0[1-9]|1[0-2])$/.test(param) ? param : today.slice(0, 7);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const shift = (d: number) => {
    const t = new Date(Date.UTC(y, m - 1 + d, 1));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  return { month, from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}`, prev: shift(-1), next: shift(1) };
}
