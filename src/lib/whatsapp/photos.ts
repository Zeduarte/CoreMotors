import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { canonicalBrand } from "@/lib/brand-name";
import { reencodePhoto } from "@/lib/photo-optimize";
import { MEDIA_BUCKET, MEDIA_CACHE_CONTROL } from "@/lib/storage";
import type { WhatsAppNumber } from "./account";
import { MAX_PHOTOS, PendingActionSchema, PhotosInput, type PendingAction } from "./actions";
import { isUsable } from "./confirm";
import { confirmationMessage, vehicleLabel } from "./describe";
import { graphBase, graphRequest } from "./graph";
import { rankVehicles, type Candidate } from "./match";
import type { InboundMedia } from "./payload";
import { REPLIES, SECTION_LABEL } from "./replies";
import { formatPlate } from "@/lib/plate";
import { STAGING_BUCKET } from "./thumbnails";

/**
 * Fotografias das viaturas pelo WhatsApp.
 *
 * Quem tira as fotografias no parque manda-as ao número da empresa e elas vão
 * parar à galeria da viatura — sem passar pelo computador. O percurso é o de
 * qualquer ordem deste canal (proposta, imagem, «sim»), com três diferenças
 * que mandam no desenho:
 *
 *  1. O ficheiro tem de ser guardado ANTES do «sim» (a Meta só o guarda uns
 *     dias e o link para o descarregar dura minutos). Fica num bucket privado
 *     (`wa-media`, migração 0039) e só passa para a galeria depois da
 *     confirmação — copiado para o MESMO bucket, o mesmo caminho e as mesmas
 *     linhas de `car_media` que o backoffice usa.
 *  2. Quem manda fotografias manda várias seguidas, e cada uma chega num
 *     pedido próprio, muitas vezes ao mesmo tempo. Responder a cada uma era
 *     spam: cada pedido guarda a sua, espera um instante, e só o da ÚLTIMA
 *     responde — por todas, numa só proposta. As que chegarem depois juntam-se
 *     à mesma proposta.
 *  3. A viatura sai da legenda («fotos do bmw 320 preto»), da última viatura
 *     tratada nesta conversa (a que o assistente acabou de criar, por exemplo)
 *     ou, se nada disso chegar, do modelo, que tem a memória da conversa e
 *     pergunta quando não é claro.
 *
 * Nada aqui apaga linhas: uma fotografia recusada fica «discarded» e a limpeza
 * da manutenção (`pruneWaMedia`) é que a apaga, dois dias depois, com o
 * ficheiro.
 */

type Db = SupabaseClient<Database>;

export { STAGING_BUCKET };

/**
 * Os formatos que o servidor sabe reduzir (o `sharp` instalado). HEIC fica de
 * fora: o `sharp` pré-compilado não o lê. O WhatsApp converte as fotografias
 * normais para JPEG; um HEIC só chega quando é mandado como documento.
 */
const ACCEPTED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
/** E o que os bytes têm de ser, seja qual for o tipo declarado. */
const READABLE_FORMATS = new Set(["jpeg", "png", "webp"]);
/** O WhatsApp limita as fotografias a 5 MB; como documento podiam ser 100. */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

/**
 * Quanto tempo cada pedido espera antes de ver se é o último da rajada. As
 * fotografias de uma rajada chegam com décimas de segundo entre si; três
 * segundos chegam e a pessoa quase não dá pela espera.
 */
export const QUIET_MS = 3000;
/** Fotografias mais antigas do que isto já não entram numa proposta nova. */
const WAITING_WINDOW_MS = 6 * 60 * 60 * 1000;
/** «A viatura de que se acabou de falar» — só se foi há pouco. */
const RECENT_CAR_MS = 60 * 60 * 1000;
/** A limpeza apaga o que tem mais do que isto (ver `prune_wa_media`). */
const PRUNE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;
/** Prazo de uma proposta (o mesmo da tabela, 0024). */
const PENDING_TTL_MS = 10 * 60 * 1000;
/** Quantas fotografias se descarregam/copiam ao mesmo tempo. */
const PARALLEL = 4;

export const PHOTO_REPLIES = {
  formato:
    "Não consigo guardar esse ficheiro: só fotografias JPEG, PNG ou WebP. Mande-a como fotografia, não como documento.",
  grande: "Essa fotografia é demasiado grande (máximo 15 MB).",
  naoDescarregou: "Não consegui receber essa fotografia. Mande-a outra vez.",
  ilegivel: "Não consegui ler essa fotografia. Mande-a outra vez, como fotografia.",
  semFotos: "Não tenho fotografias à espera. Mande-as primeiro.",
  indisponiveis:
    "Já não foi possível: as fotografias deixaram de estar disponíveis. Mande-as outra vez.",
  /** Há outra pergunta à espera: as fotografias ficam guardadas até lá. */
  primeiroResponda: (n: number) =>
    `Recebi ${fotos(n)}. Responda primeiro à pergunta anterior (sim ou não) e depois diga-me para que viatura são.`,
} as const;

function fotos(n: number): string {
  return n === 1 ? "1 fotografia" : `${n} fotografias`;
}

/** O pedido ao colaborador quando a viatura não é clara. */
export function whichVehicleQuestion(n: number, candidates: Candidate[]): string {
  const pergunta = n === 1 ? "Para que viatura é esta fotografia?" : `Para que viatura são estas ${n} fotografias?`;
  if (!candidates.length) return `${pergunta} Indique a matrícula, ou a marca e o modelo.`;
  const linhas = candidates.slice(0, 5).map((c) => {
    const cor = c.color ? ` ${c.color.toLowerCase()}` : "";
    const mat = c.license_plate ? ` · ${formatPlate(c.license_plate)}` : " · sem matrícula";
    return `- ${canonicalBrand(c.make)} ${c.model}${cor}${mat}`;
  });
  return `${pergunta}\n${linhas.join("\n")}\nIndique a matrícula.`;
}

/**
 * O que fica na memória da conversa do lado da pessoa: as fotografias não são
 * texto, mas a pergunta seguinte («qual?») só se percebe sabendo que chegaram.
 */
export function photosMemory(n: number, captions: string): string {
  return `[${fotos(n)} recebida${n === 1 ? "" : "s"}${captions ? ` — legenda: «${captions}»` : ""}]`;
}

/**
 * A mensagem que o modelo recebe quando é ele a descobrir a viatura. Escrita
 * pelo sistema; a legenda vai entre aspas, como dado.
 */
export function photosPrompt(n: number, captions: string): string {
  return (
    `[Fotografias] A pessoa mandou ${fotos(n)} para juntar a uma viatura. ` +
    (captions ? `Legenda que escreveu: «${captions}».` : "Sem legenda.")
  );
}

// ---------------------------------------------------------------------------
// Descarregar da Meta
// ---------------------------------------------------------------------------

export type Download =
  | { ok: true; data: Buffer }
  | { ok: false; reason: "grande" | "falhou"; error: string };

/**
 * O endereço que a Meta devolve é de um domínio dela, em HTTPS. O token vai
 * no pedido, por isso não se segue nenhum outro: nem HTTP, nem
 * redireccionamentos. O destino configurado (WHATSAPP_GRAPH_BASE_URL) também
 * vale, para os testes apontarem a uma Meta simulada.
 */
function trustedMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || raw.startsWith(`${graphBase()}/`);
  } catch {
    return false;
  }
}

/**
 * `GET /{media-id}` dá um link curto; `GET` a esse link, com o token, dá o
 * ficheiro. Com teto de tamanho, lido aos bocados: um ficheiro enorme é
 * cortado sem chegar inteiro à memória. Nunca lança.
 */
export async function downloadMedia(
  mediaId: string,
  number: WhatsAppNumber | null,
  maxBytes: number = MAX_PHOTO_BYTES,
): Promise<Download> {
  const fail = (reason: "grande" | "falhou", error: string): Download => ({ ok: false, reason, error });
  const token = number?.accessToken;
  if (!token) return fail("falhou", "WhatsApp não configurado");
  // O id entra num caminho do Graph API: só algarismos, nunca `../`.
  if (!/^\d{1,40}$/.test(mediaId)) return fail("falhou", "id de ficheiro inválido");

  const info = await graphRequest<{ url?: string; file_size?: number | string }>(mediaId, { token });
  if (!info.ok) return fail("falhou", info.error);
  if (Number(info.data.file_size ?? 0) > maxBytes) return fail("grande", `${info.data.file_size} bytes`);
  const url = info.data.url;
  if (!url || !trustedMediaUrl(url)) return fail("falhou", "endereço do ficheiro inválido");

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      return fail("falhou", `HTTP ${response.status}`);
    }
    if (Number(response.headers.get("content-length") ?? 0) > maxBytes) {
      await response.body.cancel().catch(() => undefined);
      return fail("grande", "content-length acima do limite");
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return fail("grande", "ficheiro acima do limite");
      }
      chunks.push(Buffer.from(value));
    }
    if (!total) return fail("falhou", "ficheiro vazio");
    return { ok: true, data: Buffer.concat(chunks) };
  } catch (error) {
    return fail("falhou", error instanceof Error ? error.message.slice(0, 200) : "falha no download");
  }
}

/**
 * Os bytes têm de ser mesmo uma fotografia de um formato aceite (o tipo que a
 * Meta indica é o que o telemóvel declarou). Depois, a mesma redução do
 * backoffice — que também tira os metadados EXIF, incluindo a localização.
 */
async function preparePhoto(data: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const meta = await sharp(data, { failOn: "none" }).metadata();
  if (!meta.format || !READABLE_FORMATS.has(meta.format)) throw new Error("formato não aceite");
  return reencodePhoto(data);
}

// ---------------------------------------------------------------------------
// Receber uma fotografia
// ---------------------------------------------------------------------------

export interface PhotoActor {
  id: string;
  secoes: string[];
  tipos: string[];
}

export interface PhotoDeps {
  db: Db;
  number?: WhatsAppNumber | null;
  /** A espera da rajada. Os testes passam uma mais curta. */
  wait?: (ms: number) => Promise<void>;
}

/**
 * O que fazer depois de guardar a fotografia. `memory` é o que fica na
 * memória da conversa do lado da pessoa, se houver resposta.
 */
export type PhotoOutcome =
  | { reply: string | null; memory?: string }
  | { action: PendingAction; memory: string }
  | { updated: { id: string; action: PendingAction } }
  | { ask: string; memory: string };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function receivePhoto(
  msg: { from: string; media: InboundMedia },
  actor: PhotoActor,
  deps: PhotoDeps,
  now: Date,
): Promise<PhotoOutcome> {
  // As fotografias são da galeria da viatura: Viaturas, como no backoffice.
  if (!actor.secoes.includes("carros")) return { reply: REPLIES.semSecao(SECTION_LABEL.carros!) };
  if (!ACCEPTED_MIME.has(msg.media.mime)) return { reply: PHOTO_REPLIES.formato };

  const got = await downloadMedia(msg.media.id, deps.number ?? null);
  if (!got.ok) {
    console.error("whatsapp downloadMedia:", got.error);
    return { reply: got.reason === "grande" ? PHOTO_REPLIES.grande : PHOTO_REPLIES.naoDescarregou };
  }
  let photo: { data: Buffer; width: number; height: number };
  try {
    photo = await preparePhoto(got.data);
  } catch {
    return { reply: PHOTO_REPLIES.ilegivel };
  }

  const id = randomUUID();
  const path = `${actor.id}/${randomUUID()}.jpg`;
  const { error: upError } = await deps.db.storage
    .from(STAGING_BUCKET)
    .upload(path, photo.data, { contentType: "image/jpeg", upsert: false });
  if (upError) {
    console.error("whatsapp photo upload:", upError.message);
    return { reply: REPLIES.falhou };
  }
  const { error: rowError } = await deps.db.from("wa_media").insert({
    id,
    from_phone: msg.from,
    actor_id: actor.id,
    media_id: msg.media.id,
    storage_path: path,
    width: photo.width,
    height: photo.height,
    bytes: photo.data.length,
    caption: msg.media.caption.trim().slice(0, 1024),
  });
  if (rowError) {
    console.error("whatsapp photo row:", rowError.message);
    await deps.db.storage.from(STAGING_BUCKET).remove([path]);
    return { reply: REPLIES.falhou };
  }

  // A rajada: só a última fotografia responde, por todas.
  await (deps.wait ?? sleep)(QUIET_MS);
  const { data: latest } = await deps.db
    .from("wa_media")
    .select("id")
    .eq("from_phone", msg.from)
    .eq("status", "staged")
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest?.id !== id) return { reply: null };
  return report(msg.from, actor, deps, now);
}

interface OpenPending {
  id: string;
  kind: string;
  payload: unknown;
  status: string;
  expires_at: string;
}

type PhotoAction = Extract<PendingAction, { kind: "add_car_media" }>;

function asPhotoAction(payload: unknown): PhotoAction | null {
  const parsed = PendingActionSchema.safeParse(payload);
  return parsed.success && parsed.data.kind === "add_car_media" ? (parsed.data as PhotoAction) : null;
}

interface Waiting {
  id: string;
  caption: string;
}

/**
 * As fotografias desta pessoa que ainda não estão em nenhuma viatura nem
 * numa proposta em aberto (`exclude`), pela ordem de chegada. As de uma
 * proposta que caducou ou foi substituída voltam a estar à espera.
 */
async function waitingPhotos(db: Db, from: string, now: Date, exclude: string[]): Promise<Waiting[]> {
  const { data } = await db
    .from("wa_media")
    .select("id,caption")
    .eq("from_phone", from)
    .eq("status", "staged")
    .gte("created_at", new Date(now.getTime() - WAITING_WINDOW_MS).toISOString())
    .order("seq", { ascending: true })
    .limit(MAX_PHOTOS * 2);
  const fora = new Set(exclude);
  return ((data ?? []) as Waiting[]).filter((w) => !fora.has(w.id));
}

/** Quantas fotografias estão à espera de viatura (para o contexto do modelo). Nunca lança. */
export async function photosWaitingNote(db: Db, from: string, now: Date): Promise<string> {
  try {
    const n = (await waitingPhotos(db, from, now, [])).length;
    if (!n) return "";
    return (
      `FOTOGRAFIAS À ESPERA\nEsta pessoa mandou ${fotos(n)} que ainda não estão em nenhuma viatura. ` +
      `Se a mensagem disser para que viatura são, procura-a e chama ${PHOTO_TOOL}.`
    );
  } catch {
    return "";
  }
}

/** O nome da ferramenta (repetido aqui para não importar tools.ts). */
const PHOTO_TOOL = "propor_fotos_viatura";

/**
 * A viatura tratada há pouco nesta conversa: a última proposta confirmada que
 * criou ou mexeu numa viatura do stock. É o caso de «cria o BMW» → «sim» →
 * fotografias, sem legenda. A pessoa vê a viatura na imagem antes de dizer «sim».
 */
async function recentCar(db: Db, from: string, now: Date): Promise<string | null> {
  const { data } = await db
    .from("wa_pending_actions")
    .select("kind,payload,result_id")
    .eq("from_phone", from)
    .eq("status", "confirmed")
    .gte("settled_at", new Date(now.getTime() - RECENT_CAR_MS).toISOString())
    .order("settled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  if (data.kind === "create_draft_car") return data.result_id ?? null;
  if (["update_car", "set_car_status", "add_car_media"].includes(data.kind)) {
    const carId = (data.payload as { carId?: unknown } | null)?.carId;
    return typeof carId === "string" ? carId : null;
  }
  return null;
}

async function loadFleet(db: Db, actor: string): Promise<Candidate[]> {
  const { data, error } = await db.rpc("wa_vehicles_for_actor", { actor });
  if (error) return [];
  return (data ?? []) as Candidate[];
}

/** A última fotografia da rajada responde: junta, propõe ou pergunta. */
async function report(from: string, actor: PhotoActor, deps: PhotoDeps, now: Date): Promise<PhotoOutcome> {
  const db = deps.db;
  const { data: open } = await db
    .from("wa_pending_actions")
    .select("id,kind,payload,status,expires_at")
    .eq("from_phone", from)
    .eq("status", "pending")
    .maybeSingle();
  const pending = (open as OpenPending | null) ?? null;
  const usable = pending !== null && isUsable(pending, now);
  // Uma proposta caducada ainda ocupa o lugar (uma por número): fecha-se.
  if (pending && !usable) {
    await db
      .from("wa_pending_actions")
      .update({ status: "expired", settled_at: now.toISOString() })
      .eq("id", pending.id);
  }
  const current = usable ? asPhotoAction(pending!.payload) : null;
  const waiting = await waitingPhotos(db, from, now, current?.fotos ?? []);

  // Já há uma proposta de fotografias em aberto: as novas juntam-se a ela.
  if (usable && current) {
    if (!waiting.length) return { reply: null };
    const action: PhotoAction = {
      ...current,
      fotos: [...current.fotos, ...waiting.map((w) => w.id)].slice(0, MAX_PHOTOS),
    };
    const { error } = await db
      .from("wa_pending_actions")
      .update({
        payload: action,
        summary: confirmationMessage(action),
        expires_at: new Date(now.getTime() + PENDING_TTL_MS).toISOString(),
      })
      .eq("id", pending!.id);
    if (error) return { reply: REPLIES.falhou };
    return { updated: { id: pending!.id, action } };
  }
  // Outra pergunta à espera: não se mexe nela. As fotografias ficam guardadas.
  if (usable) return { reply: PHOTO_REPLIES.primeiroResponda(waiting.length) };
  if (!waiting.length) return { reply: null };

  const n = waiting.length;
  const captions = waiting
    .map((w) => w.caption.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 300);
  const memory = photosMemory(n, captions);
  const fleet = await loadFleet(db, actor.id);

  if (captions) {
    const found = rankVehicles({ texto: captions }, fleet);
    if (found.length === 1) return proposeFor(found[0]!, waiting, actor, db, memory);
    if (found.length > 1) return { reply: whichVehicleQuestion(n, found), memory };
  } else {
    const recent = await recentCar(db, from, now);
    const car = recent ? fleet.find((c) => c.id === recent) : undefined;
    if (car) return proposeFor(car, waiting, actor, db, memory);
  }
  // Nada de claro: o modelo, com a memória da conversa, descobre ou pergunta.
  return { ask: photosPrompt(n, captions), memory };
}

async function proposeFor(
  car: Candidate,
  waiting: Waiting[],
  actor: PhotoActor,
  db: Db,
  memory: string,
): Promise<PhotoOutcome> {
  const built = await buildPhotoAction(db, actor, car, waiting.map((w) => w.id));
  return "action" in built ? { action: built.action, memory } : { reply: built.refusal, memory };
}

/**
 * A proposta: a viatura (lida agora, para a imagem mostrar a ficha real) e as
 * fotografias. As mesmas verificações que o SQL repete ao confirmar.
 */
async function buildPhotoAction(
  db: Db,
  actor: PhotoActor,
  car: Candidate,
  ids: string[],
): Promise<{ action: PendingAction } | { refusal: string }> {
  if (!actor.secoes.includes("carros")) return { refusal: REPLIES.semSecao(SECTION_LABEL.carros!) };
  if (!ids.length) return { refusal: PHOTO_REPLIES.semFotos };
  const { data: c } = await db
    .from("cars")
    .select("id,make,model,variant,year,price,price_on_request,status,license_plate,vehicle_type")
    .eq("id", car.id)
    .maybeSingle();
  if (!c) return { refusal: REPLIES.jaNaoDa };
  if (!actor.tipos.includes(c.vehicle_type ?? "car"))
    return {
      refusal: `Não tem acesso a ${c.vehicle_type === "motorcycle" ? "motas" : "carros"}. Fale com o responsável.`,
    };
  const { data: media } = await db.from("car_media").select("kind,is_cover").eq("car_id", c.id);
  const galeria = (media ?? []) as { kind: string; is_cover: boolean }[];
  const action = {
    kind: "add_car_media" as const,
    carId: c.id,
    veiculo: vehicleLabel(c),
    fotos: ids.slice(0, MAX_PHOTOS),
    ficha: {
      titulo: [canonicalBrand(c.make), c.model, c.variant].filter(Boolean).join(" "),
      matricula: (c.license_plate ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
      ano: c.year ?? null,
      preco: c.price_on_request ? null : (c.price ?? null),
      estado: c.status,
      existentes: galeria.filter((m) => m.kind === "image").length,
      semCapa: !galeria.some((m) => m.is_cover || m.kind === "image"),
    },
  };
  const parsed = PendingActionSchema.safeParse(action);
  if (!parsed.success) return { refusal: REPLIES.falhou };
  return { action: parsed.data as PendingAction };
}

/**
 * A ferramenta `propor_fotos_viatura`, quando é o modelo a descobrir a viatura
 * (na mensagem das fotografias ou numa resposta de texto a seguir). A viatura
 * tem de vir de uma procura desta mensagem, como nas outras propostas.
 */
export async function runPhotoProposal(
  input: unknown,
  vehicles: Map<string, Candidate>,
  actor: PhotoActor,
  from: string,
  db: Db,
  now: Date,
): Promise<{ action: PendingAction } | { refusal: string } | { result: { content: string; is_error: true } }> {
  const parsed = PhotosInput.safeParse(input ?? {});
  if (!parsed.success) return { result: { content: "Proposta inválida: falta a viatura.", is_error: true } };
  const car = vehicles.get(parsed.data.viatura);
  if (!car)
    return {
      result: {
        content: `${parsed.data.viatura} não existe nesta mensagem. Usa procurar_viatura e só depois um identificador V… que ela devolva.`,
        is_error: true,
      },
    };
  const waiting = await waitingPhotos(db, from, now, []);
  return buildPhotoAction(db, actor, car, waiting.map((w) => w.id));
}

// ---------------------------------------------------------------------------
// Depois da resposta
// ---------------------------------------------------------------------------

/** Corre `fn` sobre a lista, `PARALLEL` de cada vez, pela ordem. */
async function inBatches<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += PARALLEL) {
    out.push(...(await Promise.all(items.slice(i, i + PARALLEL).map(fn))));
  }
  return out;
}

/**
 * O «sim»: copia cada fotografia para a galeria (`car-media`,
 * `<viatura>/<uuid>.jpg`, cache de um ano — como o MediaManager) e só depois
 * regista, pela RPC, que autoriza e escolhe a ordem e a capa. Se a RPC recusar,
 * as cópias saem da galeria; se tudo correr bem, saem do bucket privado.
 *
 * Devolve `{ data, error }` como uma RPC, para o `executePending` tratar esta
 * escrita como as outras.
 */
export async function attachPhotos(
  db: Db,
  actor: string,
  action: PhotoAction,
): Promise<{ data: string | null; error: { message: string } | null }> {
  const fail = (message: string) => ({ data: null, error: { message } });
  const { data } = await db
    .from("wa_media")
    .select("id,storage_path,width,height,status")
    .in("id", action.fotos);
  const rows = new Map(((data ?? []) as WaMediaLite[]).map((r) => [r.id, r]));
  const ordered = action.fotos.map((id) => rows.get(id));
  // Todas ou nenhuma: o recibo diz quantas foram, e tem de ser verdade.
  if (ordered.some((r) => !r || r.status !== "staged")) return fail("Fotografia indisponível");
  const staged = ordered as WaMediaLite[];

  const copies = await inBatches(staged, async (row) => {
    const { data: blob, error } = await db.storage.from(STAGING_BUCKET).download(row.storage_path);
    if (error || !blob) return null;
    const path = `${action.carId}/${randomUUID()}.jpg`;
    const { error: upError } = await db.storage.from(MEDIA_BUCKET).upload(path, Buffer.from(await blob.arrayBuffer()), {
      contentType: "image/jpeg",
      cacheControl: MEDIA_CACHE_CONTROL,
      upsert: false,
    });
    return upError ? null : { media: row.id, path, width: row.width, height: row.height };
  });
  const done = copies.filter((c): c is NonNullable<typeof c> => c !== null);
  if (done.length !== staged.length) {
    if (done.length) await db.storage.from(MEDIA_BUCKET).remove(done.map((c) => c.path));
    return fail("Fotografia indisponível");
  }

  const result = await db.rpc("wa_add_car_media", { actor, car: action.carId, items: done });
  if (result.error) {
    await db.storage.from(MEDIA_BUCKET).remove(done.map((c) => c.path));
    return fail(result.error.message);
  }
  // Já estão na galeria: a cópia privada deixa de ser precisa.
  const { error: cleanError } = await db.storage.from(STAGING_BUCKET).remove(staged.map((r) => r.storage_path));
  if (cleanError) console.error("whatsapp attachPhotos cleanup:", cleanError.message);
  return { data: typeof result.data === "string" ? result.data : action.carId, error: null };
}

interface WaMediaLite {
  id: string;
  storage_path: string;
  width: number | null;
  height: number | null;
  status: string;
}

/**
 * O «não»: as fotografias ficam descartadas e os ficheiros saem do bucket
 * privado. A linha fica (sem ficheiro) até à limpeza. Nunca lança.
 */
export async function discardPhotos(db: Db, ids: string[], now: Date = new Date()): Promise<void> {
  try {
    if (!ids.length) return;
    const { data } = await db
      .from("wa_media")
      .update({ status: "discarded", settled_at: now.toISOString() })
      .in("id", ids)
      .eq("status", "staged")
      .select("storage_path");
    const paths = ((data ?? []) as { storage_path: string }[]).map((r) => r.storage_path);
    if (paths.length) await db.storage.from(STAGING_BUCKET).remove(paths);
  } catch (error) {
    console.error("whatsapp discardPhotos:", error);
  }
}

// ---------------------------------------------------------------------------
// Limpeza (manutenção)
// ---------------------------------------------------------------------------

/**
 * Fotografias com mais de dois dias: primeiro os ficheiros, depois as linhas.
 * Se o Storage falhar, as linhas ficam para a próxima — sem a linha, não se
 * saberia que ficheiro apagar. Nunca lança.
 */
export async function pruneWaMedia(db: Db, now: Date = new Date()): Promise<number> {
  try {
    const { data } = await db
      .from("wa_media")
      .select("id,storage_path")
      .lt("created_at", new Date(now.getTime() - PRUNE_AFTER_MS).toISOString())
      .limit(500);
    const rows = (data ?? []) as { id: string; storage_path: string }[];
    if (!rows.length) return 0;
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await db.storage
        .from(STAGING_BUCKET)
        .remove(rows.slice(i, i + 100).map((r) => r.storage_path));
      if (error) {
        console.error("pruneWaMedia:", error.message);
        return 0;
      }
    }
    const { data: count } = await db.rpc("prune_wa_media", { ids: rows.map((r) => r.id) });
    return typeof count === "number" ? count : 0;
  } catch (error) {
    console.error("pruneWaMedia:", error);
    return 0;
  }
}
