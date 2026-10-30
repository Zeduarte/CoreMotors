import { notFound } from "next/navigation";
import { serviceExists } from "@/lib/route-guards";

/** Serviço inexistente ou desligado → 404 a sério. */
export default async function ServiceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  if (!(await serviceExists((await params).slug))) notFound();
  return children;
}
