import { getAdminVehicleType } from "@/lib/vehicle-context";
import { showsInWorkshop } from "@/lib/vehicle-categories";
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { allRows } from "@/lib/pagination";
import { coverImage } from "@/lib/mappers";
import { publicMediaUrl } from "@/lib/storage";
import type { CarWithMedia, VehicleTaskRow } from "@/lib/supabase/database.types";

/** Viatura como o mecânico a vê: identificação + capa + horas registadas. */
export interface WorkshopVehicle {
  id: string;
  make: string;
  model: string;
  plate: string | null;
  status: string;
  cover: { src: string; alt: string };
  totalHours: number;
  logCount: number;
}

/**
 * Lista as viaturas que estão na oficina, com o total de horas registadas. Ao
 * ser dada como preparada, a viatura sai daqui e passa para Viaturas. Só
 * identificação + capa — o mecânico não edita a ficha.
 */
export async function getWorkshopVehicles(): Promise<WorkshopVehicle[]> {
  const supabase = await createClient();
  const vehicleType = await getAdminVehicleType();
  // Páginado: o Supabase corta nas 1000 primeiras linhas e as horas ficavam erradas.
  const [cars, logs] = await Promise.all([
    allRows((a, b) =>
      supabase
        .from("cars")
        .select("*, car_media(*)").eq("vehicle_type", vehicleType)
        .order("updated_at", { ascending: false })
        .order("id")
        .range(a, b),
    ),
    allRows((a, b) => supabase.from("vehicle_tasks").select("car_id, hours").order("id").range(a, b)),
  ]);

  const logRows = logs as { car_id: string; hours: number }[];
  const hoursByCar = new Map<string, number>();
  const countByCar = new Map<string, number>();
  for (const l of logRows) {
    hoursByCar.set(l.car_id, (hoursByCar.get(l.car_id) ?? 0) + Number(l.hours || 0));
    countByCar.set(l.car_id, (countByCar.get(l.car_id) ?? 0) + 1);
  }

  // Filtra-se aqui e não na query, pelo mesmo motivo de getAdminCars: os
  // estados da oficina dependem da migração 0027.
  return ((cars ?? []) as unknown as CarWithMedia[]).filter((c) => showsInWorkshop(c.status)).map((c) => ({
    id: c.id,
    make: c.make,
    model: c.model,
    plate: c.license_plate,
    status: c.status,
    cover: coverImage(c),
    totalHours: Math.round((hoursByCar.get(c.id) ?? 0) * 100) / 100,
    logCount: countByCar.get(c.id) ?? 0,
  }));
}

/** Custo (peça/material) lançado numa viatura. */
export interface WorkshopCost {
  id: string;
  category: string;
  description: string;
  amount: number;
  incurred_on: string;
  created_by: string | null;
}

/** Custos de material da viatura (para o mecânico ver o que já lançou). */
export async function getWorkshopCosts(carId: string): Promise<WorkshopCost[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vehicle_costs")
    .select("id, category, description, amount, incurred_on, created_by")
    .eq("car_id", carId)
    .order("incurred_on", { ascending: false });
  if (error) {
    // Migração 0017 por aplicar / sem permissão — não bloqueia a página.
    console.error("getWorkshopCosts:", error.message);
    return [];
  }
  return (data ?? []) as WorkshopCost[];
}

export interface WorkshopVehicleDetail {
  id: string;
  make: string;
  model: string;
  variant: string | null;
  year: number | null;
  plate: string | null;
  status: string;
  photos: { src: string; alt: string }[];
  logs: VehicleTaskRow[];
  /** Hora de fim do registo mais recente (HH:MM) — default do próximo início. */
  lastEnd: string | null;
}

/** Detalhe de uma viatura para a oficina: fotos (só ver) + registos de horas. */
export async function getWorkshopVehicle(
  id: string,
): Promise<WorkshopVehicleDetail | null> {
  const supabase = await createClient();
  const vehicleType = await getAdminVehicleType();
  const [{ data: car }, { data: logRows }] = await Promise.all([
    supabase.from("cars").select("*, car_media(*)").eq("vehicle_type", vehicleType).eq("id", id).maybeSingle(),
    supabase
      .from("vehicle_tasks")
      .select("*")
      .eq("car_id", id)
      .order("work_date", { ascending: false })
      .order("start_time", { ascending: false }),
  ]);
  if (!car) return null;
  const c = car as unknown as CarWithMedia;
  const logs = (logRows ?? []) as VehicleTaskRow[];

  // O registo mais recente (lista já ordenada) dá o "último fim" para prefill.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());
  const lastWithEnd = logs.find((l) => l.end_time && l.work_date === today);
  const lastEnd = lastWithEnd?.end_time ? lastWithEnd.end_time.slice(0, 5) : null;

  const photos = (c.car_media ?? [])
    .filter((m) => m.kind === "image")
    .sort((a, b) => Number(b.is_cover) - Number(a.is_cover) || a.position - b.position)
    .map((m) => ({
      src: publicMediaUrl(m.storage_path),
      alt: m.alt || `${c.make} ${c.model}`,
    }));

  return {
    id: c.id,
    make: c.make,
    model: c.model,
    variant: c.variant,
    year: c.year,
    plate: c.license_plate,
    status: c.status,
    photos,
    logs,
    lastEnd,
  };
}
