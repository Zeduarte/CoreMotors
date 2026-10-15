import { revalidateTag } from "next/cache";
import { revalidatePublic } from "@/lib/public-cache";

/**
 * O que cada formulário da Página inicial e das Definições limpa depois de
 * gravar.
 *
 * Vive aqui, e não nas Server Actions, porque há dois caminhos que gravam o
 * mesmo: o backoffice e o assistente de WhatsApp (`after-write.ts`). Com uma
 * cópia em cada um, um dia o site ficava desatualizado só num deles.
 */

/** Textos da página inicial (`saveHomeContent`). A homepage é ISR. */
export function afterHomeSaved(): void {
  revalidatePublic("/");
  revalidatePublic("/admin/pagina-inicial");
}

/**
 * Pontos de venda, serviços, perguntas e Google (`saveShowroom`). O ponto de
 * venda principal é a fonte dos contactos de todo o site (rodapé, contactos,
 * WhatsApp, OLX): a cache da marca tem de cair.
 */
export function afterShowroomSaved(): void {
  revalidateTag("branding");
  revalidatePublic("/", "layout");
  revalidatePublic("/admin/pagina-inicial");
  revalidatePublic("/admin/carros", "layout");
  revalidatePublic("/sitemap.xml");
}

/** Etiquetas dos cards (`saveBadges`): aparecem em todo o site público. */
export function afterBadgesSaved(): void {
  revalidatePublic("/", "layout");
  revalidatePublic("/admin/definicoes");
}

/** Marca do site (`saveSiteSettings`): aparece em todo o site e no backoffice. */
export function afterBrandingSaved(): void {
  revalidateTag("branding");
  revalidatePublic("/", "layout");
  revalidatePublic("/admin", "layout");
}

/** Canais de conversa (`saveCompany`): aparecem em todo o site. */
export function afterCompanySaved(): void {
  revalidateTag("branding");
  revalidatePublic("/", "layout");
}

/** Valor/hora da oficina (`saveWorkshopRate`). */
export function afterWorkshopRateSaved(): void {
  revalidatePublic("/admin/definicoes");
  revalidatePublic("/admin/financeiro");
}
