/*
  A minimal TypeScript loader for Node's built-in test runner.

  No test framework dependency: TypeScript is compiled with the repo's own
  `typescript` package (transpile only, no type-check -- `tsc` does that),
  and the `@/...` alias from tsconfig.json is resolved to the repo root.
  Registered by tests/setup/register.mjs.
*/
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs"];

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function probe(base) {
  if (await isFile(base)) return base;
  for (const ext of EXTENSIONS) if (await isFile(base + ext)) return base + ext;
  for (const ext of EXTENSIONS) {
    const index = resolvePath(base, "index" + ext);
    if (await isFile(index)) return index;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  let base = null;
  if (specifier.startsWith("@/")) {
    base = resolvePath(ROOT, specifier.slice(2));
  } else if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL?.startsWith("file:")
  ) {
    base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (base) {
    const found = await probe(base);
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    // Packages imported without an extension from ESM (e.g. "next/server").
    if (!specifier.startsWith(".") && !specifier.endsWith(".js")) {
      return nextResolve(specifier + ".js", context);
    }
    throw error;
  }
}

export async function load(url, context, nextLoad) {
  if (/\.(tsx?|mts)$/.test(url)) {
    const source = await readFile(fileURLToPath(url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        verbatimModuleSyntax: false,
        isolatedModules: true,
      },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
