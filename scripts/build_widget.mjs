import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Resolve esbuild from editor/ (where it is listed in package.json).
const require = createRequire(path.join(repoRoot, "editor", "package.json"));
const esbuild = require("esbuild");

const staticDir = path.join(
  repoRoot,
  "src",
  "board_pinout",
  "static",
  "board_pinout"
);
const entry = path.join(staticDir, "js", "index.js");
const outfile = path.join(staticDir, "board-pinout.js");

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: "iife",
  outfile,
  target: ["es2018"],
  logLevel: "info",
});

console.log(`Wrote ${path.relative(repoRoot, outfile)}`);
