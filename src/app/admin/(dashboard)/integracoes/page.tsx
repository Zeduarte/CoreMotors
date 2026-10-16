import { NotificationStatus } from "@/components/admin/NotificationStatus";
import { getSiteSettings, getIntegrations } from "@/lib/admin-queries";
import { requireSection } from "@/lib/guard";
import { MarketingForm } from "@/components/admin/MarketingForm";
import {
  IntegrationsForm,
  type IntegrationsInitial,
} from "@/components/admin/IntegrationsForm";
import { FeedUrls } from "@/components/admin/FeedUrls";
import { WhatsAppPanel } from "@/components/admin/WhatsAppPanel";
import Link from "next/link";
import { site } from "@/lib/site";
import { CustomerSettingsForm } from "@/components/admin/CustomerSettingsForm";
import { getCustomerSettings } from "@/lib/visit-run";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  await requireSection("integracoes");

  const [settings, integrations, customer] = await Promise.all([
    getSiteSettings(),
    getIntegrations(),
    createClient().then(getCustomerSettings),
  ]);

  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || site.url;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-paper">Integrações</h1>
        <p className="mt-1 text-sm text-paper/50">
          Exportação para portais, pagamentos e rastreio. Só administradores.
        </p>
      </div>

      <div className="space-y-6">
        <MarketingForm
          initial={{
            ga4_id: settings.ga4_id,
            pixel_id: settings.pixel_id,
            reservation_enabled: settings.reservation_enabled,
            deposit_amount: settings.deposit_amount,
          }}
        />
        <IntegrationsForm initial={integrations as IntegrationsInitial} />
        <FeedUrls baseUrl={baseUrl} />
        {/* O OLX e os outros portais geram-se agora no seu separador. */}
        <Link
          href="/admin/anuncios"
          className="card block p-5 transition-colors hover:border-accent/50"
        >
          <p className="text-lg font-semibold text-paper">Plataformas de anúncios →</p>
          <p className="mt-1 text-sm text-paper/60">
            A ligação ao OLX, as categorias, a publicação automática e as estatísticas estão no separador
            «Plataformas de anúncios». StandVirtual, CustoJusto, auto SAPO e Piscapisca: brevemente disponíveis.
          </p>
        </Link>
        <WhatsAppPanel baseUrl={baseUrl} />
        <CustomerSettingsForm
          initial={{
            visitsEnabled: customer.visitsEnabled,
            schedule: customer.schedule,
            customerWhatsApp: customer.customerWhatsApp,
          }}
          missing={customer.missing}
        />
        <NotificationStatus />
      </div>
    </>
  );
}
