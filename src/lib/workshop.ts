import { getAdminVehicleType } from "@/lib/vehicle-context";
import { showsInWorkshop } from "@/lib/vehicle-categories";
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { coverImage } from "@/lib/mappers";
import { allRows } from "@/lib/pagination";
import { getCurrentProfile } from "@/lib/admin-queries";
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
 *
 * Nada de ler tabelas inteiras: a API corta cada pedido em 1000 linhas, e os
 * registos de horas passam disso depressa — os totais ficavam errados.
 */
export async function getWorkshopVehicles(): Promise<WorkshopVehicle[]> {
  const supabase = await createClient();
  const vehicleType = await getAdminVehicleType();
  let cars: CarWithMedia[];
  try {
    cars = (await allRows((a, b) =>
      supabase
        .from("cars")
        .select("id, make, model, license_plate, status, car_media(storage_path, is_cover, kind, position, alt)")
        .eq("vehicle_type", vehicleType)
        .eq("status", "workshop")
        .order("updated_at", { ascending: false })
        .order("id")
        .range(a, b),
    )) as unknown as CarWithMedia[];
  } catch (e) {
    // Sem a migração 0027 o estado "workshop" não existe — e então também
    // não há viaturas na oficina.
    console.error("getWorkshopVehicles:", e instanceof Error ? e.message : e);
    return [];
  }

  const totals = await workshopTotals(cars.map((c) => c.id));
  return cars.filter((c) => showsInWorkshop(c.status)).map((c) => ({
    id: c.id,
    make: c.make,
    model: c.model,
    plate: c.license_plate,
    status: c.status,
    cover: coverImage(c),
    totalHours: Math.round((totals.get(c.id)?.hours ?? 0) * 100) / 100,
    logCount: totals.get(c.id)?.count ?? 0,
  }));
}

/**
 * Horas e número de registos por viatura. Somados na base de dados (vista
 * da 0046); sem ela, lê-se página a página.
 */
async function workshopTotals(
  carIds: string[],
): Promise<Map<string, { hours: number; count: number }>> {
  const totals = new Map<string, { hours: number; count: number }>();
  if (!carIds.length) return totals;
  const supabase = await createClient();
  try {
    const rows = await allRows((a, b) =>
      supabase
        .from("vehicle_task_totals")
        .select("car_id, total_hours, log_count")
        .in("car_id", carIds)
        .order("car_id")
        .range(a, b),
    );
    for (const r of rows) {
      totals.set(r.car_id, { hours: Number(r.total_hours) || 0, count: Number(r.log_count) || 0 });
    }
    return totals;
  } catch {
    // Migração 0046 por aplicar: soma-se aqui, sem perder linhas.
  }
  const logs = await allRows((a, b) =>
    supabase.from("vehicle_tasks").select("car_id, hours").in("car_id", carIds).order("id").range(a, b),
  ).catch((e: unknown) => {
    console.error("workshopTotals:", e instanceof Error ? e.message : e);
    return [] as { car_id: string; hours: number }[];
  });
  for (const l of logs) {
    const t = totals.get(l.car_id) ?? { hours: 0, count: 0 };
    t.hours += Number(l.hours || 0);
    t.count += 1;
    totals.set(l.car_id, t);
  }
  return totals;
}

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * `me` pode corrigir/apagar as horas registadas por `author`? As próprias,
 * sempre; as dos outros, quem está acima na hierarquia (a regra da base de
 * dados, 0046). Sem essa migração, só o administrador mexe nas dos outros.
 */
export async function canManageHoursOf(
  db: Db,
  me: { id: string; role: string },
  author: string | null,
): Promise<boolean> {
  if (author && author === me.id) return true;
  const { data, error } = await db.rpc("can_manage_hours_of", { target: author });
  if (error) return me.role === "admin";
  return data === true;
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
  /** Ids dos registos que quem vê pode fechar ou apagar. */
  manageable: string[];
  /** Hora de fim do registo mais recente (HH:MM) — default do próximo início. */
  lastEnd: string | null;
}

/** Detalhe de uma viatura para a oficina: fotos (só ver) + registos de horas. */
export async function getWorkshopVehicle(
  id: string,
): Promise<WorkshopVehicleDetail | null> {
  const supabase = await createClient();
  const vehicleType = await getAdminVehicleType();
  const [{ data: car }, logRows, me] = await Promise.all([
    supabase.from("cars").select("*, car_media(*)").eq("vehicle_type", vehicleType).eq("id", id).maybeSingle(),
    allRows((a, b) =>
      supabase
        .from("vehicle_tasks")
        .select("*")
        .eq("car_id", id)
        .order("work_date", { ascending: false })
        .order("start_time", { ascending: false })
        .order("id")
        .range(a, b),
    ).catch((e: unknown) => {
      console.error("getWorkshopVehicle:", e instanceof Error ? e.message : e);
      return [];
    }),
    getCurrentProfile(),
  ]);
  if (!car) return null;
  const c = car as unknown as CarWithMedia;
  const logs = logRows as VehicleTaskRow[];

  // Que registos quem está a ver pode fechar/apagar (o RLS volta a decidir).
  const autores = [...new Set(logs.map((l) => l.created_by))];
  const pode = new Map(
    await Promise.all(
      autores.map(async (a) => [a, !!me && (await canManageHoursOf(supabase, me, a))] as const),
    ),
  );
  const manageable = logs.filter((l) => pode.get(l.created_by)).map((l) => l.id);

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
    manageable,
    lastEnd,
  };
}
