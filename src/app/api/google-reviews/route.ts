import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getShowroomContent } from "@/lib/showroom-queries";
import { googlePlaceSchema, type GooglePlace } from "@/lib/google-reviews";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** As avaliações mudam devagar: um pedido pago ao Google a cada 12 horas. */
const REVALIDATE_S = 12 * 60 * 60;
/** Depois de uma falha do Google, não se volta a tentar durante 5 minutos. */
const RETRY_AFTER_MS = 5 * 60 * 1000;
let lastFailure = 0;

/** Erro passageiro (rede, 429, 5xx): não fica guardado na cache. */
class TransientError extends Error {}

/**
 * Leitura do Google Places, guardada no servidor por `placeId`. Cada visita
 * já não é um pedido pago ao Google, e por isso também deixou de gastar a
 * quota das submissões públicas (partilhada com formulários e o assistente).
 * Uma resposta definitiva (ficha inexistente, chave inválida) também fica
 * guardada; as falhas passageiras não.
 */
const fetchPlace = unstable_cache(
  async (placeId: string): Promise<GooglePlace | null> => {
    const key = process.env.GOOGLE_PLACES_API_KEY;
    if (!key) return null;
    let response: Response;
    try {
      // Fixed origin and encoded ID: no caller-controlled upstream URL or credentials.
      response = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=pt-PT`,
        {
          headers: {
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask":
              "rating,userRatingCount,googleMapsUri,reviews,attributions",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
          redirect: "error",
        },
      );
    } catch {
      throw new TransientError("rede");
    }
    if (response.status === 429 || response.status >= 500)
      throw new TransientError(String(response.status));
    if (!response.ok) return null;
    const result = googlePlaceSchema.safeParse(await response.json());
    return result.success ? result.data : null;
  },
  ["google-reviews"],
  { revalidate: REVALIDATE_S, tags: ["google-reviews"] },
);

export async function GET() {
  const { google } = await getShowroomContent();
  if (!google.enabled || !google.placeId || !process.env.GOOGLE_PLACES_API_KEY)
    return NextResponse.json({ available: false }, { headers });
  if (Date.now() - lastFailure < RETRY_AFTER_MS)
    return NextResponse.json({ available: false }, { headers });
  try {
    const place = await fetchPlace(google.placeId);
    return NextResponse.json(
      place ? { available: true, place } : { available: false },
      { headers },
    );
  } catch {
    lastFailure = Date.now();
    return NextResponse.json({ available: false }, { headers });
  }
}
