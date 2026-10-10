import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";

/**
 * Cache das leituras públicas (viaturas, conteúdos, etiquetas, testemunhos).
 *
 * As páginas públicas são geradas a cada visita (leem o cookie carros/motas),
 * por isso sem isto cada visita e cada clique faziam várias consultas ao
 * Supabase. Os resultados ficam guardados 60 segundos e, quando o backoffice
 * grava alguma coisa, `revalidatePublic` limpa-os logo — o site nunca fica
 * desatualizado à espera do minuto.
 */
export const PUBLIC_DATA_TAG = "public-data";
const PUBLIC_REVALIDATE_S = 60;

/** Guarda o resultado de `fn` (por argumentos) com a etiqueta pública. */
export function cachedPublic<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  key: string,
): (...args: A) => Promise<R> {
  return unstable_cache(fn, ["public", key], {
    tags: [PUBLIC_DATA_TAG],
    revalidate: PUBLIC_REVALIDATE_S,
  });
}

/**
 * Corre uma leitura em cache; se falhar, regista e devolve `fallback`. As
 * leituras lançam em vez de devolver vazio, para um erro passageiro do Supabase
 * nunca ficar guardado na cache durante um minuto.
 */
export async function safely<T>(label: string, load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch (e) {
    console.error(`${label}:`, e instanceof Error ? e.message : e);
    return fallback;
  }
}

/** `revalidatePath` + limpa a cache pública. Para as ações que mudam o site. */
export function revalidatePublic(...args: Parameters<typeof revalidatePath>) {
  revalidatePath(...args);
  revalidateTag(PUBLIC_DATA_TAG);
}
