import { requireOwner } from "@/lib/guard";
import { getSiteAppearance } from "@/lib/site-theme-query";
import { SiteThemeForm } from "@/components/admin/SiteThemeForm";
import { THEMES, defaultLayout, resolveLayout } from "@/themes/index";
import { HomeLayoutForm } from "@/components/admin/HomeLayoutForm";
import { getHomeContent } from "@/lib/queries";
import { MediaStorageCard } from "@/components/admin/MediaStorageCard";
import { getMediaStorageStatus } from "@/lib/actions/media-storage";
import { SiteConfigCard } from "@/components/admin/SiteConfigCard";
import { siteConfig } from "@/lib/site-config";
import { getLegalSettings } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";

/**
 * Gestão: o que é da plataforma e não de cada stand. Só o acesso core (o dono
 * da conta) — nem os administradores do stand a veem.
 */
export default async function GestaoPage() {
  await requireOwner();
  const [current, media, legal, home] = await Promise.all([
    getSiteAppearance(),
    getMediaStorageStatus(),
    getLegalSettings(),
    getHomeContent(),
  ]);
  const themes = Object.values(THEMES).map(({ id, label, description, adminNotes }) => ({ id, label, description, notes: adminNotes ?? [] }));
  // A página inicial de cada versão (o «Que segmento procura?» de origem é o
  // que estava escolhido em Página inicial → Secções).
  const layouts = Object.values(THEMES).map((t) => ({
    id: t.id,
    label: t.label,
    fixed: t.fixedSections ?? [],
    items: resolveLayout(t, current.layouts[t.id], home.showSegments),
    defaults: defaultLayout(t, home.showSegments),
  }));

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-paper">Gestão</h1>
        <p className="mt-1 text-sm text-paper/50">Só o acesso core vê este separador.</p>
      </div>

      <div className="mb-6">
        <h2 className="text-lg font-semibold text-paper">Versão do site</h2>
        <p className="mt-1 text-sm text-paper/50">
          O aspeto do site público. Os dados (viaturas, contactos, textos da página inicial) são os mesmos em
          todas as versões. Cada versão pode ser escura, clara ou seguir o sistema de quem visita.
        </p>
      </div>
      <SiteThemeForm initial={current.theme} initialModes={current.modes} themes={themes} />

      <div className="mb-6 mt-10">
        <h2 className="text-lg font-semibold text-paper">Página inicial</h2>
        <p className="mt-1 text-sm text-paper/50">
          As secções da página inicial de cada versão: ligue ou desligue cada uma e mude a ordem com as setas. Uma secção
          desligada não é carregada (a página fica mais leve). Os textos e as fotos continuam em Página inicial.
        </p>
      </div>
      <HomeLayoutForm themes={layouts} initialTheme={current.theme} />

      <div className="mb-6 mt-10">
        <h2 className="text-lg font-semibold text-paper">Fotos</h2>
        <p className="mt-1 text-sm text-paper/50">
          Onde ficam as fotos e vídeos das viaturas. No Cloudflare R2 o tráfego das fotos não tem custo nem conta para
          os limites do Supabase.
        </p>
      </div>
      <MediaStorageCard initial={media} />

      <div className="mb-6 mt-10">
        <h2 className="text-lg font-semibold text-paper">Configuração deste site</h2>
        <p className="mt-1 text-sm text-paper/50">
          Cada stand tem o seu projeto: base de dados (Supabase), fotos (Cloudflare R2) e site (Netlify). Confirme aqui a
          que projeto este site está ligado.
        </p>
      </div>
      <SiteConfigCard config={siteConfig()} dbReady={!legal.missing} />
    </>
  );
}
