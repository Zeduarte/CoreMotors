import type { Vehicle } from "@/types/vehicle";

/**
 * Viatura só com o que os cartões e os filtros usam, para as listas (página
 * inicial, stock, favoritos, vendidos, relacionadas). Os campos pesados — a
 * descrição, o equipamento, a ficha técnica alargada e o vídeo — só fazem
 * falta na ficha da própria viatura, que os lê à parte. Sem isto, cada lista
 * mandava para o browser o texto completo de todas as viaturas do stock.
 *
 * As fotos ficam pelas primeiras: o cartão mostra a capa e, com rato, deixa
 * passar algumas com as setas (no telemóvel só se vê a capa). A galeria
 * completa está na ficha.
 */
const LIST_PHOTOS = 5;

export function toListVehicle(v: Vehicle): Vehicle {
  return {
    ...v,
    description: "",
    tagline: "",
    extras: undefined,
    highlights: [],
    video: null,
    olxAttributes: undefined,
    images: v.images.slice(0, LIST_PHOTOS),
  };
}
