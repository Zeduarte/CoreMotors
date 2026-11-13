import type { VehicleType } from "@/lib/vehicle-categories";
import Link from "next/link";
import { mediaFor } from "@/lib/media";

/**
 * Chamada para retoma / encomenda. A foto (retoma.jpg em public/media/carros|motas/) é o
 * FUNDO do card, com um escurecimento diagonal para o texto se manter legível.
 * Se a imagem não existir, fica o fundo sólido (bg-ink-soft) — nada parte.
 *
 * O título fala do tipo da ficha («Tem uma mota para trocar?»); na página
 * inicial de um site com carros e motas (`mixed`), de uma viatura qualquer.
 */
export function SellCTA({
  vehicleType = "car",
  mixed = false,
}: {
  vehicleType?: VehicleType;
  /** O site vende carros e motas e não há uma viatura em causa: texto neutro. */
  mixed?: boolean;
}) {
  const what = mixed ? "uma viatura" : vehicleType === "motorcycle" ? "uma mota" : "um carro";
  return (
    <section className="container-px py-20 md:py-28">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-ink-soft">
        {/* Imagem de fundo */}
        <div
          aria-hidden
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${mediaFor(vehicleType).retoma})` }}
        />
        {/* Escurecimento para contraste do texto (mais escuro à esquerda). */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-ink/95 via-ink/80 to-ink/45"
        />

        <div className="relative z-10 grid gap-8 px-8 py-14 md:grid-cols-2 md:items-center md:px-12 md:py-20">
          <div>
            <p className="eyebrow mb-4">Retoma & Encomenda</p>
            <h2 className="text-3xl font-semibold text-paper md:text-4xl">
              Tem {what} para trocar? Ou procura algo específico?
            </h2>
            <p className="mt-4 max-w-md text-paper/70">
              Avalie a sua retoma em minutos ou peça a viatura ideal — mesmo que
              ainda não esteja no nosso stock.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row md:justify-end">
            <Link
              href="/vender"
              className="rounded-full bg-accent px-7 py-3.5 text-center text-sm font-semibold text-ink transition-transform hover:scale-[1.03]"
            >
              Avaliar a minha retoma
            </Link>
            <Link
              href="/vender"
              className="rounded-full border border-white/30 bg-ink/30 px-7 py-3.5 text-center text-sm font-medium text-paper backdrop-blur transition-colors hover:border-white/60"
            >
              Encomendar viatura
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
