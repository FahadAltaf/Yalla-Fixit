// Casing-proof dev launcher (Windows).
//
// Turbopack compares paths case-sensitively. If you launch the dev server from
// a differently-cased path than the folder's real on-disk name — e.g. `cd
// portal` when the folder is `Portal` — the workspace root no longer matches
// the file paths and CSS `@import "tailwindcss"` fails with
// "Can't resolve 'tailwindcss'" (resolving from the repo root instead of here).
//
// This launcher resolves the project's REAL casing via realpathSync.native and
// starts `next dev` from there, so it works no matter how you `cd` in. It runs
// under whatever runtime invoked it (node or bun), so `bun run dev` stays bun.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = fs.realpathSync.native(path.resolve(here, ".."));
const nextBin = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");

// Default port 3032 (matches the old script); extra CLI args pass through.
const passthrough = process.argv.slice(2);
const args = ["dev", ...(passthrough.includes("-p") || passthrough.includes("--port") ? [] : ["-p", "3032"]), ...passthrough];

const child = spawn(process.execPath, [nextBin, ...args], { cwd: projectRoot, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  console.error("Failed to launch next dev:", err);
  process.exit(1);
});
