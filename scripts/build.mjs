#!/usr/bin/env node
// Build the static site into dist/.
// 1. Try a fresh export from EDUcore (if credentials are present).
// 2. Fall back to the committed snapshot in data/atlas.json if the export fails,
//    so a graph outage never takes the site down.
import { cp, mkdir, rm, access, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exportSnapshot } from "./export.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(ROOT, "dist");
const SNAP = resolve(ROOT, "data/atlas.json");
const exists = (p) => access(p).then(() => true, () => false);

const hasCreds = process.env.NEO4J_URI || process.env.EDUCORE_MCP_TOKEN;
if (hasCreds && process.env.SKIP_EXPORT !== "1") {
  try { await exportSnapshot(); }
  catch (e) { console.warn(`⚠ Export failed, using committed snapshot: ${e.message}`); }
} else {
  console.log("No graph credentials (or SKIP_EXPORT=1); using committed snapshot.");
}

if (!(await exists(SNAP))) {
  console.error("✗ data/atlas.json is missing. Run `npm run export` with credentials first.");
  process.exit(1);
}
const snap = JSON.parse(await readFile(SNAP, "utf8"));

await rm(DIST, { recursive: true, force: true });
await mkdir(resolve(DIST, "data"), { recursive: true });
await cp(resolve(ROOT, "src"), DIST, { recursive: true });
await cp(SNAP, resolve(DIST, "data/atlas.json"));
console.log(`✓ Built dist/ from snapshot ${snap.generatedAt} (${snap.source})`);
