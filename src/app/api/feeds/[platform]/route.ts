import { NextResponse } from "next/server";
import { getChannelVehicles, getBranding } from "@/lib/queries";
import { CHANNEL_IDS, CHANNELS } from "@/lib/schemas";
import { site } from "@/lib/site";
import { supabasePublic } from "@/lib/supabase/public";
import { toCsv, toOlxXml, toXml, type OlxCategoryFields } from "@/lib/feeds";

export const runtime = "nodejs";
export const revalidate = 300; // feed atualiza a cada 5 min

type Params = Promise<{ platform: string }>;

function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || site.url
  );
}

/** Categoria do OLX guardada para cada tipo (sem a migração 0032: nenhuma). */
async function olxCategories(): Promise<OlxCategoryFields[]> {
  const { data, error } = await supabasePublic.rpc("olx_category_fields");
  return error ? [] : ((data ?? []) as OlxCategoryFields[]);
}

/**
 * Feed público de exportação por plataforma.
 *
 *   /api/feeds/standvirtual        → XML
 *   /api/feeds/standvirtual.xml    → XML
 *   /api/feeds/standvirtual.csv    → CSV
 *   /api/feeds/olx?format=csv      → CSV
 *
 * Inclui apenas viaturas publicadas com esse canal selecionado no backoffice.
 * Estes feeds contêm apenas dados já públicos das viaturas — podem ser
 * importados pelos portais que suportam feeds/imports de inventário.
 */
export async function GET(
  request: Request,
  { params }: { params: Params },
) {
  const { platform: raw } = await params;
  const url = new URL(request.url);

  let platform = raw;
  let format: "xml" | "csv" = "xml";
  if (raw.endsWith(".csv")) {
    platform = raw.slice(0, -4);
    format = "csv";
  } else if (raw.endsWith(".xml")) {
    platform = raw.slice(0, -4);
  }
  if (url.searchParams.get("format") === "csv") format = "csv";

  if (!(CHANNEL_IDS as string[]).includes(platform)) {
    return NextResponse.json(
      { error: "Plataforma desconhecida", available: CHANNEL_IDS },
      { status: 404 },
    );
  }

  const label = CHANNELS.find((c) => c.id === platform)?.label ?? platform;
  const vehicles = await getChannelVehicles(platform);

  if (format === "csv") {
    return new NextResponse(toCsv(vehicles, siteUrl()), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `inline; filename="${platform}.csv"`,
      },
    });
  }

  // O OLX tem um formato próprio (<offers>/<offer>); os restantes canais usam
  // o feed genérico. Ambos só contêm dados já públicos das viaturas.
  if (platform === "olx") {
    const [{ company }, categories] = await Promise.all([getBranding(), olxCategories()]);
    return new NextResponse(toOlxXml(vehicles, company, siteUrl(), categories), {
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
  }

  return new NextResponse(toXml(vehicles, label, siteUrl()), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
