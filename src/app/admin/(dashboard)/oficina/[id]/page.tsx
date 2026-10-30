import { PreparationPanel } from "@/components/admin/PreparationPanel";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { requireSection } from "@/lib/guard";
import { getWorkshopVehicle, getWorkshopCosts } from "@/lib/workshop";
import { TaskManager } from "@/components/admin/TaskManager";
import { WorkshopCostsPanel } from "@/components/admin/WorkshopCostsPanel";
import { WorkshopStage } from "@/components/admin/WorkshopStage";
import { StatusBadge } from "@/components/admin/StatusBadge";
import type { CarStatus } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function OficinaVehiclePage({
  params,
}: {
  params: Params;
}) {
  await requireSection("oficina");
  const { id } = await params;
  const vehicle = await getWorkshopVehicle(id);
  if (!vehicle) notFound();
  const costs = await getWorkshopCosts(id);

  return (
    <>
      <Link
        href="/admin/oficina"
        className="mb-6 inline-flex items-center gap-2 text-sm text-paper/60 hover:text-paper"
      >
        <span aria-hidden>←</span> Oficina
      </Link>

      {/* Cabeçalho da viatura (só leitura) */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-paper">
            {vehicle.make} {vehicle.model !== "—" ? vehicle.model : ""}
            {vehicle.variant ? ` ${vehicle.variant}` : ""}
          </h1>
          <p className="mt-1 font-mono text-sm text-accent">
            {vehicle.plate || "— sem matrícula —"}
          </p>
        </div>
        {vehicle.year && (
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-paper/60">
            {vehicle.year}
          </span>
        )}
        <StatusBadge status={vehicle.status as CarStatus} />
        <div className="sm:ml-auto">
          <WorkshopStage carId={vehicle.id} status={vehicle.status as CarStatus} preparedTo="/admin/oficina" />
        </div>
      </div>
      {vehicle.status === "prepared" && (
        <p className="-mt-3 mb-6 text-sm text-paper/50">
          Preparada: já aparece em Viaturas para ser completada e publicada.
        </p>
      )}

      {/* Fotos (só ver) */}
      {vehicle.photos.length > 0 && (
        <div className="mb-8 -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
          {vehicle.photos.map((p, i) => (
            <div
              key={i}
              className="relative aspect-[4/3] w-48 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-ink-muted"
            >
              <Image
                src={p.src}
                alt={p.alt}
                fill
                sizes="192px"
                className="object-cover"
              />
            </div>
          ))}
        </div>
      )}

      <div className="mb-8"><PreparationPanel carId={vehicle.id}/></div>
      <TaskManager
        carId={vehicle.id}
        initial={vehicle.logs}
        lastEnd={vehicle.lastEnd}
        manageable={vehicle.manageable}
      />

      <div className="mt-8">
        <WorkshopCostsPanel carId={vehicle.id} initial={costs} />
      </div>
    </>
  );
}
