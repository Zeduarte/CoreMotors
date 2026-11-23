import "server-only";
import { AwsClient } from "aws4fetch";
import { MEDIA_CACHE_HEADER } from "@/lib/storage";

/**
 * Cloudflare R2 (API compatível com S3), só no servidor: as chaves vêm das
 * variáveis do Netlify e nunca vão para o browser. O browser carrega as fotos
 * com um endereço assinado que vale poucos minutos (`presignPut`).
 *
 * Variáveis: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 * (e R2_ENDPOINT só para testes, em vez do endereço da conta).
 */

export interface R2Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** As variáveis que faltam (para a Gestão dizer quais). */
export function r2Missing(): string[] {
  const need = ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];
  if (!process.env.R2_ENDPOINT) need.unshift("R2_ACCOUNT_ID");
  return need.filter((k) => !(process.env[k] ?? "").trim());
}

export function r2Config(): R2Config | null {
  if (r2Missing().length) return null;
  const account = (process.env.R2_ACCOUNT_ID ?? "").trim();
  const endpoint = (process.env.R2_ENDPOINT ?? "").trim() || `https://${account}.r2.cloudflarestorage.com`;
  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    bucket: process.env.R2_BUCKET!.trim(),
    accessKeyId: process.env.R2_ACCESS_KEY_ID!.trim(),
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!.trim(),
  };
}

function client(cfg: R2Config) {
  return new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: "s3",
    region: "auto",
  });
}

const objectUrl = (cfg: R2Config, path: string, query = "") =>
  `${cfg.endpoint}/${encodeURIComponent(cfg.bucket)}/${path.split("/").map(encodeURIComponent).join("/")}${query}`;

function need(): R2Config {
  const cfg = r2Config();
  if (!cfg) throw new Error(`Cloudflare R2 sem configuração (falta: ${r2Missing().join(", ")})`);
  return cfg;
}

/**
 * Um pedido assinado ao R2. Assina-se sem o corpo (o S3 aceita
 * «UNSIGNED-PAYLOAD») e o corpo vai depois, direto no `fetch`, como bytes
 * simples: assim leva sempre o tamanho (`Content-Length`). Se fosse dentro de
 * um `Request` já montado (como o `aws4fetch.fetch` faz), em alguns ambientes
 * — no Netlify, por exemplo — o ficheiro seguia em «stream», sem tamanho, e o
 * R2 recusava (411 MissingContentLength).
 */
async function call(url: string, init: { method?: string; body?: Buffer | Uint8Array | Blob; headers?: Record<string, string> } = {}) {
  const cfg = need();
  const { body, ...rest } = init;
  const signed = await client(cfg).sign(url, rest);
  const bytes =
    body == null ? undefined : body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : new Uint8Array(body);
  const headers = new Headers(signed.headers);
  if (bytes) headers.set("Content-Length", String(bytes.byteLength));
  return fetch(signed.url, { method: signed.method, headers, body: bytes, cache: "no-store" });
}

export async function r2Put(path: string, body: Buffer | Uint8Array | Blob, contentType: string): Promise<void> {
  const cfg = need();
  const res = await call(objectUrl(cfg, path), {
    method: "PUT",
    body,
    headers: { "Content-Type": contentType || "application/octet-stream", "Cache-Control": MEDIA_CACHE_HEADER },
  });
  if (!res.ok) throw new Error(`R2 PUT ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** O ficheiro, ou null se não existir. */
export async function r2Get(path: string): Promise<{ data: Buffer; type: string } | null> {
  const cfg = need();
  const res = await call(objectUrl(cfg, path));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 GET ${res.status}`);
  return { data: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") ?? "application/octet-stream" };
}

export async function r2Exists(path: string): Promise<boolean> {
  const cfg = need();
  const res = await call(objectUrl(cfg, path), { method: "HEAD" });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`R2 HEAD ${res.status}`);
  return true;
}

export async function r2Delete(paths: string[]): Promise<void> {
  const cfg = need();
  const failed: string[] = [];
  // Um a um (em paralelo, aos poucos): o pedido em lote do S3 exige assinaturas
  // de conteúdo que não valem a pena para meia dúzia de ficheiros.
  for (let i = 0; i < paths.length; i += 10) {
    await Promise.all(
      paths.slice(i, i + 10).map(async (p) => {
        const res = await call(objectUrl(cfg, p), { method: "DELETE" });
        if (!res.ok && res.status !== 404) failed.push(p);
      }),
    );
  }
  if (failed.length) throw new Error(`R2 DELETE falhou em ${failed.length} ficheiro(s)`);
}

/** Copia dentro do bucket (no servidor do R2, sem descarregar). */
export async function r2Copy(from: string, to: string): Promise<void> {
  const cfg = need();
  const res = await call(objectUrl(cfg, to), {
    method: "PUT",
    headers: { "x-amz-copy-source": `/${cfg.bucket}/${from.split("/").map(encodeURIComponent).join("/")}` },
  });
  if (!res.ok) throw new Error(`R2 COPY ${res.status}`);
}

export interface R2Object {
  path: string;
  size: number;
}

/** Todos os ficheiros com este prefixo (todas as páginas). */
export async function r2List(prefix = ""): Promise<R2Object[]> {
  const cfg = need();
  const out: R2Object[] = [];
  let token: string | null = null;
  for (let page = 0; page < 200; page++) {
    const qs = new URLSearchParams({ "list-type": "2", "max-keys": "1000" });
    if (prefix) qs.set("prefix", prefix);
    if (token) qs.set("continuation-token", token);
    const res = await call(`${cfg.endpoint}/${encodeURIComponent(cfg.bucket)}?${qs}`);
    if (!res.ok) throw new Error(`R2 LIST ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = /<Key>([\s\S]*?)<\/Key>/.exec(m[1]!)?.[1];
      const size = Number(/<Size>(\d+)<\/Size>/.exec(m[1]!)?.[1] ?? 0);
      if (key) out.push({ path: decodeXml(key), size });
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
      ? decodeXml(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "") || null
      : null;
    if (!token) break;
  }
  return out;
}

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/**
 * Endereço assinado para o browser carregar um ficheiro (PUT), válido 10
 * minutos. O browser tem de mandar exatamente estes cabeçalhos (vão assinados).
 */
export async function presignPut(
  path: string,
  contentType: string,
): Promise<{ url: string; headers: Record<string, string> }> {
  const cfg = need();
  const headers = { "Content-Type": contentType || "application/octet-stream", "Cache-Control": MEDIA_CACHE_HEADER };
  const url = new URL(objectUrl(cfg, path));
  url.searchParams.set("X-Amz-Expires", "600");
  const signed = await client(cfg).sign(url.toString(), { method: "PUT", headers, aws: { signQuery: true } });
  return { url: signed.url, headers };
}
