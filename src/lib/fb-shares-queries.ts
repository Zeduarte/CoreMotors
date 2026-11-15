import "server-only";
import { createClient } from "@/lib/supabase/server";
import { allRows } from "@/lib/pagination";
import type { FbAccountRow, FbGroupRow, FbShareAdRow, FbShareAttemptRow } from "@/lib/supabase/database.types";

export interface ShareCarOption {
  id: string;
  label: string;
  price: number | null;
  vehicle_type: "car" | "motorcycle";
}

export interface SharesData {
  accounts: FbAccountRow[];
  /** A conta aberta (a do `?conta=`, ou a primeira). */
  account: FbAccountRow | null;
  groups: FbGroupRow[];
  ads: FbShareAdRow[];
  /** O histórico da conta aberta (todas as tentativas). */
  attempts: FbShareAttemptRow[];
  cars: ShareCarOption[];
  /** As tabelas ainda não existem (migração 0052 por aplicar). */
  missingTables: boolean;
}

const EMPTY: Omit<SharesData, "missingTables"> = { accounts: [], account: null, groups: [], ads: [], attempts: [], cars: [] };

/**
 * Tudo o que o separador Partilhas mostra, do utilizador com sessão: o RLS só
 * devolve o que é dele, por isso não se filtra por `profile_id` aqui.
 */
export async function getSharesData(accountId: string | undefined): Promise<SharesData> {
  const supabase = await createClient();
  const { data: accounts, error } = await supabase.from("fb_accounts").select("*").order("created_at");
  if (error) {
    const missing = /fb_accounts|does not exist|schema cache/i.test(error.message);
    if (!missing) console.error("getSharesData fb_accounts:", error.message);
    return { ...EMPTY, missingTables: missing };
  }
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0] ?? null;

  const [groups, ads, attempts, cars] = await Promise.all([
    account
      ? allRows((a, b) => supabase.from("fb_groups").select("*").eq("account_id", account.id).order("id").range(a, b))
      : Promise.resolve([] as FbGroupRow[]),
    supabase
      .from("fb_share_ads")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => data ?? []),
    account
      ? allRows((a, b) => supabase.from("fb_share_attempts").select("*").eq("account_id", account.id).order("id").range(a, b))
      : Promise.resolve([] as FbShareAttemptRow[]),
    // As viaturas à venda que o utilizador pode ver, para ligar um anúncio a uma.
    supabase
      .from("cars")
      .select("id, make, model, year, price, vehicle_type, status")
      .in("status", ["published", "reserved", "prepared"])
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) =>
        (data ?? []).map((c) => ({
          id: c.id,
          label: [c.make, c.model, c.year].filter(Boolean).join(" "),
          price: c.price,
          vehicle_type: (c.vehicle_type ?? "car") as "car" | "motorcycle",
        })),
      ),
  ]);

  // Na lista: primeiro os que ainda aparecem no Facebook, pela ordem dele.
  groups.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.name.localeCompare(b.name, "pt-PT"));
  attempts.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return { accounts, account, groups, ads, attempts, cars, missingTables: false };
}
