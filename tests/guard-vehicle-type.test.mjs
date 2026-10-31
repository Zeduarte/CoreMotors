import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);

// A barreira por tipo de viatura (carros/motas) das Server Actions.
let profile = null;
let carTypes = {};
const db = {
  from() {
    return {
      select() {
        return {
          async in(_col, ids) {
            return { data: ids.filter((id) => carTypes[id]).map((id) => ({ vehicle_type: carTypes[id] })), error: null };
          },
        };
      },
    };
  },
};

const cache = new Map();
function load(file) {
  file = resolve(file);
  if (cache.has(file)) return cache.get(file);
  const mod = { exports: {} };
  cache.set(file, mod.exports);
  const custom = (id) => {
    if (id === "server-only") return {};
    if (id === "next/navigation")
      return {
        redirect(to) {
          throw new Error(`redirect:${to}`);
        },
      };
    if (id === "@/lib/admin-queries") return { getCurrentProfile: async () => profile };
    if (id === "@/lib/supabase/server") return { createClient: async () => db };
    if (id.startsWith("@/") || id.startsWith(".")) {
      let path = id.startsWith("@/") ? resolve("src", id.slice(2)) : resolve(dirname(file), id);
      if (!existsSync(path)) path += ".ts";
      return load(path);
    }
    return require(id);
  };
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  new Function("module", "exports", "require", outputText)(mod, mod.exports, custom);
  cache.set(file, mod.exports);
  return mod.exports;
}

const { requireVehicleType, requireCarsAccess } = load("src/lib/guard.ts");
const denied = (fn) => assert.rejects(fn, /redirect:\/admin$/);

await test("quem só tem carros não cria nem mexe em motas", async () => {
  profile = { id: "u1", role: "vendedor", allowed_sections: null, allowed_vehicle_types: ["car"] };
  carTypes = { "car-1": "car", "bike-1": "motorcycle" };
  await requireVehicleType("car");
  await denied(() => requireVehicleType("motorcycle"));
  await requireCarsAccess(["car-1"]);
  await denied(() => requireCarsAccess(["bike-1"]));
  await denied(() => requireCarsAccess(["car-1", "bike-1"]));
});

await test("um id escondido pela RLS (ou que não existe) também é recusado", async () => {
  profile = { id: "u1", role: "vendedor", allowed_sections: null, allowed_vehicle_types: ["car"] };
  // A RLS por tipo esconde a mota: a consulta só devolve a linha do carro.
  carTypes = { "car-1": "car" };
  await denied(() => requireCarsAccess(["hidden-bike"]));
  await denied(() => requireCarsAccess(["car-1", "hidden-bike"]));
  // O mesmo id repetido não conta como em falta.
  await requireCarsAccess(["car-1", "car-1"]);
});

await test("o admin e quem não tem restrição acedem aos dois tipos", async () => {
  carTypes = { "car-1": "car", "bike-1": "motorcycle" };
  profile = { id: "u2", role: "admin", allowed_sections: null, allowed_vehicle_types: ["car"] };
  await requireVehicleType("motorcycle");
  await requireCarsAccess(["car-1", "bike-1"]);
  profile = { id: "u3", role: "vendedor", allowed_sections: null, allowed_vehicle_types: null };
  await requireVehicleType("motorcycle");
  await requireCarsAccess(["bike-1"]);
});

await test("sem sessão vai para o login e uma lista vazia não pede nada", async () => {
  profile = null;
  await assert.rejects(() => requireVehicleType("car"), /redirect:\/admin\/login$/);
  await assert.rejects(() => requireCarsAccess(["car-1"]), /redirect:\/admin\/login$/);
  await requireCarsAccess([]);
});
