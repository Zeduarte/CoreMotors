import { getSiteSettings, getCompanySettings } from "@/lib/admin-queries";
import { requireSection } from "@/lib/guard";
import { BrandingForm } from "@/components/admin/BrandingForm";
import { CompanyForm } from "@/components/admin/CompanyForm";
import { BadgesForm } from "@/components/admin/BadgesForm";
import { PhotoOptimizer } from "@/components/admin/PhotoOptimizer";
import { getBadges } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const me = await requireSection("definicoes");
  // Quem tem o separador sem ser administrador vê as definições e pode otimizar
  // as fotos (photos.ts só pede o separador); gravar é só para o administrador.
  const isAdmin = me.role === "admin";

  const [settings, company, badges] = await Promise.all([
    getSiteSettings(),
    getCompanySettings(),
    getBadges(),
  ]);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-paper">Definições</h1>
        <p className="mt-1 text-sm text-paper/50">
          Marca e dados de contacto do site. Só administradores podem alterar.
        </p>
      </div>

      {!isAdmin && (
        <p className="card mb-6 p-4 text-sm text-paper/70">
          Só de leitura: alterar a marca, os contactos e as etiquetas é só para administradores. Pode usar «Otimizar fotos».
        </p>
      )}

      <fieldset disabled={!isAdmin} className="min-w-0">
      <BrandingForm initial={settings} />

      <div className="mt-10 mb-6 border-t border-white/10 pt-8">
        <h2 className="text-lg font-semibold text-paper">Contactos</h2>
        <p className="mt-1 text-sm text-paper/50">
          WhatsApp e Messenger. Os restantes contactos vêm do ponto de venda principal (Página inicial).
        </p>
      </div>

      <CompanyForm initial={company} />

      <div className="mt-10 mb-6 border-t border-white/10 pt-8">
        <h2 className="text-lg font-semibold text-paper">Etiquetas dos cards</h2>
        <p className="mt-1 text-sm text-paper/50">
          As etiquetas que aparecem por cima da foto das viaturas («Nacional», «Novidade», «Poucos km», …):
          o texto, a cor e se aparecem. Pode criar etiquetas suas e marcá-las em cada viatura.
        </p>
      </div>

      <BadgesForm initial={badges} />
      </fieldset>

      <div className="mt-10 mb-6 border-t border-white/10 pt-8">
        <h2 className="text-lg font-semibold text-paper">Otimizar fotos</h2>
        <p className="mt-1 text-sm text-paper/50">Fotos das viaturas mais leves, para o site carregar mais depressa.</p>
      </div>

      <PhotoOptimizer />
    </>
  );
}
