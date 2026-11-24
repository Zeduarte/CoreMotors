import { ShowroomForm } from "@/components/admin/ShowroomForm";
import { getShowroomContent } from "@/lib/showroom-queries";
import Link from "next/link";
import { getHomeContent } from "@/lib/queries";
import { requireSection } from "@/lib/guard";
import { HomeContentForm } from "@/components/admin/HomeContentForm";

export const dynamic = "force-dynamic";

export default async function HomeContentPage() {
  await requireSection("pagina-inicial");
  const content = await getHomeContent();

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-paper">Página inicial</h1>
          <p className="mt-1 text-sm text-paper/50">
            Edite os textos e botões do topo, marcas, secção de confiança e a
            chamada final. As viaturas em destaque gerem-se em Viaturas.
          </p>
        </div>
        <Link href="/" target="_blank" className="btn-ghost">
          ↗ Ver página
        </Link>
      </div>

      <HomeContentForm initial={content} />
      <ShowroomForm
        initial={await getShowroomContent()}
        googleKey={googleKeyStatus(process.env.GOOGLE_PLACES_API_KEY)}
      />
    </>
  );
}

// As chaves da Google Cloud começam por «AIza». Um Place ID («ChIJ…») posto na
// variável por engano parecia «configurado» e as avaliações nunca apareciam.
function googleKeyStatus(raw: string | undefined): "ok" | "missing" | "invalid" {
  const key = (raw ?? "").trim();
  if (!key) return "missing";
  return key.startsWith("AIza") ? "ok" : "invalid";
}
