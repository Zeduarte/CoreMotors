import { registrationLabel } from "@/lib/vehicle-categories";
import type { Metadata, ResolvingMetadata } from "next";
import { pageMetadata } from "@/components/seo/page-metadata";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getVehicleBySlug, getBranding } from "@/lib/queries";
import { formatKm, formatNumber, priceLabel } from "@/lib/format";
import { qrDataUrl } from "@/lib/qr";
import { site } from "@/lib/site";
import { PrintButton } from "@/components/vehicle/PrintButton";

export const revalidate = 60;

type Params = Promise<{ slug: string }>;

// Fora do índice, com o canónico da ficha (do layout); partilhada, aponta
// também para a ficha da viatura.
export async function generateMetadata(
  { params }: { params: Params },
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const { slug } = await params;
  const v = await getVehicleBySlug(slug);
  if (!v) return { title: "Ficha", robots: { index: false, follow: false } };
  return pageMetadata(parent, {
    title: `Ficha — ${v.make} ${v.model}`,
    path: `/viaturas/${v.slug}`,
    canonical: false,
    robots: { index: false, follow: false },
  });
}

export default async function FichaPage({ params }: { params: Params }) {
  const { slug } = await params;
  const [vehicle, branding] = await Promise.all([
    getVehicleBySlug(slug),
    getBranding(),
  ]);
  if (!vehicle) notFound();

  const url = `${site.url}/viaturas/${vehicle.slug}`;
  const qr = await qrDataUrl(url);

  const isMoto = vehicle.vehicleType === "motorcycle";
  // As linhas a `null` não aparecem: uma ficha cheia de «—» parece incompleta.
  const specs: [string, string | null][] = [
    ["Preço", priceLabel(vehicle.price, vehicle.priceOnRequest)],
    [
      "Primeira matrícula",
      registrationLabel(vehicle.year, vehicle.registrationMonth),
    ],
    ["Quilómetros", formatKm(vehicle.mileage)],
    ["Combustível", vehicle.fuel],
    ["Caixa", vehicle.transmission],
    [isMoto ? "Categoria" : "Carroçaria", vehicle.body],
    ["Potência", vehicle.power ? `${vehicle.power} cv` : null],
    [
      "Cilindrada",
      vehicle.displacement ? `${formatNumber(vehicle.displacement)} cm³` : null,
    ],
    ["Cor", vehicle.color || null],
    // As motas não têm portas.
    ["Portas", !isMoto && vehicle.doors ? String(vehicle.doors) : null],
    ["Lugares", vehicle.seats ? String(vehicle.seats) : null],
    ["Nº de donos", vehicle.owners ? String(vehicle.owners) : null],
    ["Livro de revisões", vehicle.serviceBook ? "Sim" : null],
    [
      "Garantia",
      vehicle.warrantyMonths ? `${vehicle.warrantyMonths} meses` : null,
    ],
    ["Última inspeção", vehicle.lastInspection || null],
    ["Nacional", vehicle.national ? "Sim" : null],
    ["Localização", vehicle.location || null],
  ];
  const shown = specs.filter((s): s is [string, string] => s[1] !== null);

  return (
    <div className="ficha mx-auto max-w-3xl px-6 pb-24 pt-28 text-paper">
      <style>{`
        @media print {
          /* Só a ficha: o cabeçalho, o rodapé, o botão de contacto, o aviso de
             cookies e o resto do site não entram na impressão. */
          @page { size: A4; margin: 0; }
          html, body { background: #fff !important; }
          body * { visibility: hidden !important; }
          header, footer { display: none !important; }
          main { padding: 0 !important; }
          .ficha, .ficha * { visibility: visible !important; }
          .ficha .no-print { display: none !important; }
          .ficha {
            max-width: none !important;
            margin: 0 !important;
            padding: 12mm 14mm !important;
            color: #000 !important;
          }
          .ficha dl > div { break-inside: avoid; }
        }
      `}</style>

      <div className="no-print mb-6 flex items-center justify-between">
        <Link
          href={`/viaturas/${vehicle.slug}`}
          className="text-sm text-paper/60 hover:text-paper"
        >
          ← Voltar à viatura
        </Link>
        <PrintButton />
      </div>

      <div className="rounded-2xl border border-white/10 bg-ink-soft p-6 md:p-10 print:rounded-none print:border-none print:bg-white print:p-0">
        <div className="flex items-start justify-between gap-6">
          <div>
            {branding.logoUrl ? (
              <Image
                src={branding.logoUrl}
                alt={branding.companyName}
                width={200}
                height={50}
                className="h-10 w-auto object-contain"
              />
            ) : (
              <p className="text-sm font-semibold uppercase tracking-wider text-accent">
                {branding.companyName}
              </p>
            )}
            <h1 className="mt-3 text-3xl font-bold print:mt-2 print:text-2xl">
              {vehicle.make} {vehicle.model}
            </h1>
            {vehicle.variant && (
              <p className="text-paper/60 print:text-black/60">
                {vehicle.variant}
              </p>
            )}
            <p className="mt-2 text-2xl font-bold text-accent">
              {priceLabel(vehicle.price, vehicle.priceOnRequest)}
            </p>
          </div>
          {qr && (
            <div className="text-center">
              <Image
                src={qr}
                alt="QR code da viatura"
                width={120}
                height={120}
                unoptimized
                className="rounded-lg"
              />
              <p className="mt-1 text-[10px] text-paper/40 print:text-black/50">
                Ver online
              </p>
            </div>
          )}
        </div>

        <div className="relative mt-6 aspect-[16/9] overflow-hidden rounded-xl bg-ink-muted print:mt-4 print:aspect-[2/1]">
          <Image
            src={vehicle.images[0]!.src}
            alt={vehicle.images[0]!.alt}
            fill
            sizes="(max-width:768px) 100vw, 720px"
            priority
            className="object-cover"
          />
        </div>

        <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3 print:mt-5 print:grid-cols-3 print:gap-y-2">
          {shown.map(([k, v]) => (
            <div
              key={k}
              className="border-b border-white/5 pb-2 print:border-black/10"
            >
              <dt className="text-[11px] uppercase tracking-wider text-paper/40 print:text-black/50">
                {k}
              </dt>
              <dd className="text-sm font-medium">{v}</dd>
            </div>
          ))}
        </dl>

        {vehicle.extras && vehicle.extras.length > 0 && (
          <div className="mt-8 print:mt-5">
            <p className="text-[11px] uppercase tracking-wider text-paper/40 print:text-black/50">
              Extras
            </p>
            <p className="mt-2 text-sm text-paper/80 print:text-black/80">
              {vehicle.extras.join(" · ")}
            </p>
          </div>
        )}

        <div className="mt-8 border-t border-white/10 pt-4 text-xs print:mt-6 text-paper/50 print:border-black/10 print:text-black/60">
          {branding.companyName} · {branding.company.phone} ·{" "}
          {branding.company.email} · {branding.company.address.street},{" "}
          {branding.company.address.city}
        </div>
      </div>
    </div>
  );
}
