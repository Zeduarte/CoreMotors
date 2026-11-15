import { requireSection } from "@/lib/guard";
import { getSharesData } from "@/lib/fb-shares-queries";
import { SharesPanel } from "@/components/admin/SharesPanel";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ conta?: string }>;

/**
 * Partilhas no Facebook: cada utilizador tem as suas contas do Facebook (um
 * separador por conta, com o nome que escolher), os grupos de cada uma e os
 * anúncios a partilhar. Os cliques no Facebook são feitos pela extensão
 * «CoreMotors Partilhas» no Chrome de quem está a usar a página.
 */
export default async function PartilhasPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSection("partilhas");
  const { conta } = await searchParams;
  const data = await getSharesData(conta);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-paper">Partilhas</h1>
        <p className="mt-1 text-sm text-paper/50">
          Partilhe os seus anúncios nos grupos do Facebook, grupo a grupo, a partir do seu Chrome. Cada conta do Facebook tem
          os seus grupos; só você vê as suas contas e o seu histórico.
        </p>
      </div>

      {data.missingTables ? (
        <p role="alert" className="card p-4 text-sm text-amber-300">
          Falta aplicar a migração <code>0052_facebook_shares.sql</code> no Supabase.
        </p>
      ) : (
        <SharesPanel
          key={data.account?.id ?? "sem-conta"}
          accounts={data.accounts}
          account={data.account}
          groups={data.groups}
          ads={data.ads}
          attempts={data.attempts}
          cars={data.cars}
          extensionZip="/extensao/coremotors-partilhas.zip"
        />
      )}
    </>
  );
}
