import "server-only";
import { createClient } from "@/lib/supabase/server";
import { allRows } from "@/lib/pagination";
import type {
  FbAccountRow,
  FbCategoryRow,
  FbGroupJoinRow,
  FbGroupRow,
  FbScheduleRow,
  FbShareAdRow,
  FbShareAttemptRow,
} from "@/lib/supabase/database.types";

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
  /** As categorias (palavras-chave) do utilizador, para todas as contas. */
  categories: FbCategoryRow[];
  /** Os pedidos de adesão a grupos da conta aberta (os mais recentes primeiro). */
  joins: FbGroupJoinRow[];
  /** Os horários automáticos da conta aberta. */
  schedules: FbScheduleRow[];
  /** As tabelas ainda não existem (migração 0052 por aplicar). */
  missingTables: boolean;
  /** Falta a migração 0056 (procurar grupos, categorias e horários). */
  missingDiscovery: boolean;
}

const EMPTY: Omit<SharesData, "missingTables"> = {
  accounts: [],
  account: null,
  groups: [],
  ads: [],
  attempts: [],
  cars: [],
  categories: [],
  joins: [],
  schedules: [],
  missingDiscovery: false,
};

const isMissing = (message: string) => /does not exist|schema cache/i.test(message);

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

  let missingDiscovery = false;
  const discovery = <T,>(where: string) => ({ data, error }: { data: T[] | null; error: { message: string } | null }): T[] => {
    if (error) {
      if (isMissing(error.message)) missingDiscovery = true;
      else console.error(`getSharesData ${where}:`, error.message);
    }
    return data ?? [];
  };

  const [groups, ads, attempts, cars, categories, joins, schedules] = await Promise.all([
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
    supabase.from("fb_categories").select("*").order("name").then(discovery<FbCategoryRow>("fb_categories")),
    account
      ? supabase
          .from("fb_group_joins")
          .select("*")
          .eq("account_id", account.id)
          .order("created_at", { ascending: false })
          .limit(1000)
          .then(discovery<FbGroupJoinRow>("fb_group_joins"))
      : Promise.resolve([] as FbGroupJoinRow[]),
    account
      ? supabase
          .from("fb_schedules")
          .select("*")
          .eq("account_id", account.id)
          .order("at_time")
          .then(discovery<FbScheduleRow>("fb_schedules"))
      : Promise.resolve([] as FbScheduleRow[]),
  ]);

  // Na lista: primeiro os que ainda aparecem no Facebook, pela ordem dele.
  groups.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.name.localeCompare(b.name, "pt-PT"));
  attempts.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return {
    accounts,
    account,
    groups,
    ads,
    attempts,
    cars,
    categories,
    joins,
    schedules,
    missingTables: false,
    missingDiscovery,
  };
}
