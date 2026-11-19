import { requireOwner } from "@/lib/guard";
import { getSiteTheme } from "@/lib/site-theme-query";
import { SiteThemeForm } from "@/components/admin/SiteThemeForm";
import { THEMES } from "@/themes/index";

export const dynamic = "force-dynamic";

/**
 * Gestão: o que é da plataforma e não de cada stand. Só o acesso core (o dono
 * da conta) — nem os administradores do stand a veem.
 */
export default async function GestaoPage() {
  await requireOwner();
  const current = await getSiteTheme();
  const themes = Object.values(THEMES).map(({ id, label, description }) => ({ id, label, description }));

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
          todas as versões.
        </p>
      </div>
      <SiteThemeForm initial={current} themes={themes} />
    </>
  );
}
