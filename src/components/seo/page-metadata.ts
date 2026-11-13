import type { Metadata, ResolvingMetadata } from "next";

/**
 * Metadados de uma página pública: título, descrição, canónico e Open Graph
 * com o endereço DA PRÓPRIA página.
 *
 * O Next junta os metadados por chave: um `openGraph` de uma página substitui
 * o herdado por inteiro. Sem `openGraph` próprio, cada página partilhava-se
 * com o `og:url` da página inicial (o Facebook e o LinkedIn usam-no como o
 * endereço da partilha); com um só com o `url`, perdia o nome do site, a
 * língua e a imagem. Por isso vêm do pai (o layout raiz e a imagem de
 * `opengraph-image.tsx`), e só o endereço — e a imagem, se a página tiver uma
 * melhor — é desta página.
 *
 * O `og:title` e o `og:description` não se repetem aqui: sem eles no
 * `openGraph`, o Next usa o título (já com o nome do stand) e a descrição da
 * página.
 */
export async function pageMetadata(
  parent: ResolvingMetadata,
  {
    title,
    description,
    path,
    images,
    canonical = true,
    ...rest
  }: {
    title?: Metadata["title"];
    description?: string;
    /** O caminho da página (ex.: "/inventario"), sem pesquisa. */
    path: string;
    /**
     * Imagem de partilha própria; sem ela, a do pai. `false` quando a página
     * tem um `opengraph-image` na própria pasta (a ficha da viatura): o Next
     * só o usa se o `openGraph` da página não trouxer `images`.
     */
    images?: string[] | false;
    /** `false` nas páginas fora do índice que não precisam de canónico. */
    canonical?: boolean;
  } & Omit<Metadata, "title" | "description" | "openGraph" | "alternates">,
): Promise<Metadata> {
  const og = (await parent).openGraph;
  const image =
    images === false ? undefined : images?.length ? images : og?.images?.length ? og.images : undefined;
  return {
    ...rest,
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
    ...(canonical && { alternates: { canonical: path } }),
    openGraph: {
      type: "website",
      locale: og?.locale ?? "pt_PT",
      ...(og?.siteName && { siteName: og.siteName }),
      url: path,
      ...(image && { images: image }),
    },
  };
}
