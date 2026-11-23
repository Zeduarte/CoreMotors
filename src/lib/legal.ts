/**
 * Identificação legal da empresa (rodapé + páginas legais) e a ficha de
 * intermediário de crédito. São de cada stand: editam-se em Definições →
 * Empresa (site_settings, migração 0057) e leem-se com `getLegal()`.
 */
export interface LegalInfo {
  /** Nome legal (ex.: «Fulano – Stand, Unipessoal Lda»); null se não preenchido. */
  legalName: string | null;
  nif: string | null;
  /** Ficha de intermediário de crédito (Banco de Portugal), PDF; null se o stand não for intermediário. */
  creditInfoUrl: string | null;
}

export const EMPTY_LEGAL: LegalInfo = { legalName: null, nif: null, creditInfoUrl: null };

/**
 * Os dados que estavam no código antes da 0057 (os da Supermotas, o primeiro
 * stand). Só se usam numa base de dados que ainda não tem a 0057 aplicada —
 * a da Supermotas, até a aplicar. Uma base nova já nasce com a 0057 (e com
 * os campos vazios), por isso nunca os mostra. Apagar quando a 0057 estiver
 * aplicada em todos os stands.
 */
export const LEGACY_LEGAL: LegalInfo = {
  legalName: "Carlos Moreira – Supermotas, Unipessoal Lda",
  nif: "518429261",
  creditInfoUrl: "/documentos/informacao-intermediario-credito.pdf",
};

/** Data mostrada nas páginas legais como "última atualização". */
export const LEGAL_UPDATED = "agosto de 2026";

/** «Nome legal | NIF: 123» — com o que houver (o nome do stand se faltar o legal). */
export function legalLine(legal: LegalInfo, companyName: string): string {
  const name = legal.legalName || companyName;
  return legal.nif ? `${name} | NIF: ${legal.nif}` : name;
}
