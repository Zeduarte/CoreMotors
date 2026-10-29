// Carrega módulos TypeScript da app (transpile + CommonJS), com substitutos
// para o que depende do Next ou da sessão. `mocks` mapeia ids de import para
// objetos (ou funções que os devolvem, avaliadas a cada import).
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);

export function createLoader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    file = resolve(file);
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} };
    cache.set(file, mod.exports);
    const custom = (id) => {
      if (id in mocks) return typeof mocks[id] === 'function' ? mocks[id]() : mocks[id];
      if (id === 'server-only') return {};
      if (id.startsWith('@/') || id.startsWith('.')) {
        let path = id.startsWith('@/') ? resolve('src', id.slice(2)) : resolve(dirname(file), id);
        if (!existsSync(path)) path = existsSync(`${path}.tsx`) ? `${path}.tsx` : `${path}.ts`;
        return load(path);
      }
      return require(id);
    };
    const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    });
    new Function('module', 'exports', 'require', outputText)(mod, mod.exports, custom);
    cache.set(file, mod.exports);
    return mod.exports;
  }
  return load;
}
