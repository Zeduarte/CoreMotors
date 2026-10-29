import { notFound } from "next/navigation";
import { vehicleExists } from "@/lib/route-guards";

/** Viatura inexistente → 404 a sério, antes de o esqueleto ser enviado. */
export default async function VehicleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  if (!(await vehicleExists((await params).slug))) notFound();
  return children;
}
