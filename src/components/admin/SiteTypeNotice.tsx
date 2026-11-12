import Link from "next/link";
import type { VehicleType } from "@/lib/vehicle-categories";
import { SITE_MODES, siteModeOf } from "@/lib/site-types";

const PLURAL: Record<VehicleType, string> = { car: "carros", motorcycle: "motas" };
const NEW: Record<VehicleType, string> = { car: "novos", motorcycle: "novas" };

/**
 * Num site de um só tipo (Definições → Tipo de site), o backoffice continua a
 * mostrar as viaturas do outro tipo — para acabar contactos, oficina e vendas
 * e retirar anúncios —, mas elas não aparecem no site nem se criam novas. Este
 * aviso diz isso, em vez de as deixar parecer à venda.
 */
export function SiteTypeNotice({
  allowedTypes,
  siteTypes,
  isAdmin = false,
  className = "",
}: {
  /** O que o utilizador pode gerir. */
  allowedTypes: readonly VehicleType[];
  /** O que o site vende. */
  siteTypes: readonly VehicleType[];
  isAdmin?: boolean;
  className?: string;
}) {
  const offSite = allowedTypes.filter((t) => !siteTypes.includes(t));
  if (!offSite.length) return null;
  const mode = SITE_MODES.find((m) => m.value === siteModeOf(siteTypes))?.label ?? "";
  const names = offSite.map((t) => PLURAL[t]).join(" e ");
  const nothing = offSite.length === allowedTypes.length;
  return (
    <p
      role="note"
      className={`rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-200 ${className}`}
    >
      {nothing ? (
        <>
          O site está em «{mode}» e o seu perfil só gere {names}: não há nada
          que possa publicar no site. Fale com o administrador.
        </>
      ) : (
        <>
          O site está em «{mode}»: as {names} continuam aqui para acabar
          contactos, oficina e vendas, mas não aparecem no site e não se criam{" "}
          {NEW[offSite[0]!]}.
          {isAdmin && (
            <>
              {" "}
              <Link href="/admin/definicoes" className="underline underline-offset-2">
                Tipo de site
              </Link>
            </>
          )}
        </>
      )}
    </p>
  );
}
