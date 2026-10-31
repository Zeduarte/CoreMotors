import "server-only";
import { createClient } from "@/lib/supabase/server";
import { allRows } from "@/lib/pagination";
import { mergeHours, type HoursEntry, type OtherHoursRow, type VehicleHoursRow } from "@/lib/hours";

export interface HoursData {
  entries: HoursEntry[];
  /** A tabela `time_entries` ainda não existe (migração 0029 por aplicar). */
  missingTable: boolean;
}

/**
 * Horas de um período. `personId` null = de toda a gente (o RLS só o deixa ao
 * administrador; os outros recebem só as suas de qualquer forma).
 *
 * As horas de viatura só chegam a quem tem a Oficina (é o RLS de
 * `vehicle_tasks`) — quem não a tem também não as regista.
 */
export async function getHours(from: string, to: string, personId: string | null): Promise<HoursData> {
  const supabase = await createClient();

  // Página a página: a API corta cada pedido em 1000 linhas, e um mês da
  // equipa inteira passa disso — os totais ficavam errados sem aviso.
  const vehicleRows = (cols: string) =>
    allRows((a, b) => {
      let q = supabase.from("vehicle_tasks").select(cols).gte("work_date", from).lte("work_date", to);
      if (personId) q = q.eq("created_by", personId);
      return q.order("id").range(a, b) as unknown as PromiseLike<{ data: VehicleHoursRow[] | null; error: { message: string } | null }>;
    });
  const otherRows = (cols: string) =>
    allRows((a, b) => {
      let q = supabase.from("time_entries").select(cols).gte("work_date", from).lte("work_date", to);
      if (personId) q = q.eq("profile_id", personId);
      return q.order("id").range(a, b) as unknown as PromiseLike<{ data: OtherHoursRow[] | null; error: { message: string } | null }>;
    });

  const V = "id, car_id, work_date, start_time, end_time, hours, description, created_by";
  const O = "id, profile_id, work_date, start_time, end_time, hours, description";
  // O nome de quem foi apagado só existe com a migração 0046; sem ela lê-se o resto.
  const comNome = <T,>(ler: (cols: string) => Promise<T[]>, base: string, nome: string) =>
    ler(`${base}, ${nome}`).catch((e: Error) => (e.message.includes(nome) ? ler(base) : Promise.reject(e)));

  const [vehicle, other] = await Promise.allSettled([
    comNome(vehicleRows, V, "created_by_name"),
    comNome(otherRows, O, "profile_name"),
  ]);
  if (vehicle.status === "rejected") console.error("getHours vehicle_tasks:", String(vehicle.reason));
  const oError = other.status === "rejected" ? String(other.reason) : null;
  const missingTable = !!oError && /time_entries|does not exist|schema cache/i.test(oError);
  if (oError && !missingTable) console.error("getHours time_entries:", oError);

  const tasks = vehicle.status === "fulfilled" ? vehicle.value : [];
  // O nome da viatura vem numa segunda consulta: a tipagem não conhece a
  // relação vehicle_tasks → cars.
  const carIds = [...new Set(tasks.map((t) => t.car_id))];
  if (carIds.length) {
    const cars = await allRows((a, b) =>
      supabase.from("cars").select("id, make, model, license_plate").in("id", carIds).order("id").range(a, b),
    ).catch(() => []);
    const byId = new Map(cars.map((c) => [c.id, c]));
    for (const t of tasks) t.car = byId.get(t.car_id) ?? null;
  }

  return {
    entries: mergeHours(tasks, other.status === "fulfilled" ? other.value : []),
    missingTable,
  };
}
