import { notFound } from "next/navigation";
import { getSiteVehicleTypes } from "@/lib/queries";

/**
 * /carros num site que não vende este tipo (Definições → Tipo de site): 404 a
 * sério, aqui no layout — antes do esqueleto (`loading.tsx`), que mandava o
 * 200 e deixava um «soft 404» que o Google indexava como página vazia.
 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  if (!(await getSiteVehicleTypes()).includes("car")) notFound();
  return children;
}
