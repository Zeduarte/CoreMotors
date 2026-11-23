// Gera public/extensao/coremotors-partilhas.zip a partir da pasta extension/,
// para o separador Partilhas do backoffice a oferecer para descarregar.
// Corre antes do dev e do build (package.json); o ZIP não vai para o Git.
//
// ZIP escrito à mão (deflate do zlib + CRC-32): evita uma dependência só para isto.
//
// Com EXTENSION_SYNC_DIR (no ambiente ou no .env.local) copia também os
// ficheiros para essa pasta: a pasta de onde o Chrome carrega a extensão
// («Carregar sem compactação»), para ficar sempre na versão do projeto. Depois
// basta carregar em ↻ em chrome://extensions. `npm run extensao` faz só isto.
import { readdirSync, readFileSync, mkdirSync, writeFileSync, statSync, existsSync, copyFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { deflateRawSync } from "node:zlib";

const SRC = "extension";
const OUT_DIR = join("public", "extensao");
const OUT = join(OUT_DIR, "coremotors-partilhas.zip");
const PREFIX = "coremotors-partilhas/";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function files(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))
    .sort();
}

/** Data/hora no formato do DOS (fixa: o ZIP sai igual se nada mudou). */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

function buildZip() {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const path of files(SRC)) {
    const name = Buffer.from(PREFIX + relative(SRC, path).split(sep).join("/"), "utf8");
    const data = readFileSync(path);
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão necessária
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + packed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

statSync(join(SRC, "manifest.json"));
mkdirSync(OUT_DIR, { recursive: true });
const zip = buildZip();
writeFileSync(OUT, zip);
const version = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8")).version;
console.log(`extensão v${version}: ${OUT} (${(zip.length / 1024).toFixed(1)} KB)`);

/** A pasta do Chrome, de EXTENSION_SYNC_DIR (ambiente primeiro, depois .env.local). */
function syncDir() {
  if (process.env.EXTENSION_SYNC_DIR) return process.env.EXTENSION_SYNC_DIR.trim();
  if (!existsSync(".env.local")) return null;
  const line = readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((l) => /^\s*EXTENSION_SYNC_DIR\s*=/.test(l));
  return line ? line.replace(/^\s*EXTENSION_SYNC_DIR\s*=\s*/, "").replace(/^["']|["']$/g, "").trim() || null : null;
}

const dir = syncDir();
if (dir) {
  // Só uma pasta que já é da extensão (tem o manifest dela): nunca escreve noutro sítio por engano.
  const manifest = join(dir, "manifest.json");
  let ok = false;
  try {
    ok = JSON.parse(readFileSync(manifest, "utf8")).name === "CoreMotors Partilhas";
  } catch {}
  if (!ok) console.warn(`extensão: ${dir} não tem a extensão CoreMotors Partilhas; não copiei nada.`);
  else {
    for (const path of files(SRC)) {
      const to = join(dir, relative(SRC, path));
      mkdirSync(join(to, ".."), { recursive: true });
      copyFileSync(path, to);
    }
    console.log(`extensão v${version} copiada para ${dir} (carregue em ↻ em chrome://extensions)`);
  }
}
