/**
 * As redes sociais do stand (Definições → Contactos → Redes sociais), no
 * rodapé de todas as versões do site. Ficam em `site_content` (chave
 * `social`), que o site público já lê: não precisam de colunas novas.
 */

export const SOCIAL_NETWORKS = ["facebook", "instagram"] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];
export type SocialLinks = Record<SocialNetwork, string>;

export const EMPTY_SOCIAL: SocialLinks = { facebook: "", instagram: "" };

export const SOCIAL_LABEL: Record<SocialNetwork, string> = { facebook: "Facebook", instagram: "Instagram" };

/** Os domínios aceites de cada rede (um link para outro sítio não passa). */
const HOSTS: Record<SocialNetwork, string[]> = {
  facebook: ["facebook.com", "fb.com", "fb.me"],
  instagram: ["instagram.com", "instagr.am"],
};

/**
 * O link como se guarda: com `https://`, de um domínio da rede. Aceita o
 * endereço sem `https://` («facebook.com/stand») e, no Instagram, o nome
 * («@stand»). Vazio é «sem link». `null` quando não é um link dessa rede.
 */
export function normalizeSocial(network: SocialNetwork, raw: string): string | null {
  const value = raw.trim();
  if (!value) return "";
  if (network === "instagram" && /^@?[\w.]{1,30}$/.test(value) && !value.includes(".com"))
    return `https://www.instagram.com/${value.replace(/^@/, "")}`;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  if (!HOSTS[network].includes(host) || url.pathname.length < 2) return null;
  url.protocol = "https:";
  return url.toString();
}

/** O que está guardado (só links válidos de cada rede). */
export function parseSocial(content: unknown): SocialLinks {
  const raw = (content ?? {}) as Partial<Record<SocialNetwork, unknown>>;
  return Object.fromEntries(
    SOCIAL_NETWORKS.map((n) => [n, typeof raw[n] === "string" ? (normalizeSocial(n, raw[n]) ?? "") : ""]),
  ) as SocialLinks;
}
