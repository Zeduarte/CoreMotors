import { notFound } from "next/navigation";
import { getSiteTheme } from "@/lib/site-theme-query";
import { getSiteVehicleTypes } from "@/lib/queries";

/** /moto4 só existe no Core3 e num site que venda motas (404 a sério, antes do esqueleto). */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const [theme, types] = await Promise.all([getSiteTheme(), getSiteVehicleTypes()]);
  if (theme !== "core3" || !types.includes("motorcycle")) notFound();
  return children;
}
