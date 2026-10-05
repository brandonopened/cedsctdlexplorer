#!/usr/bin/env node
// Minimal static server for local preview: `npm run dev` (serves src/ + data/).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = process.argv[2] === "dist" ? resolve(ROOT, "dist") : null;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const port = Number(process.env.PORT || 4173);

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/") path = "/index.html";
  const file = DIR ? resolve(DIR, "." + path)
    : path.startsWith("/data/") ? resolve(ROOT, "." + path) : resolve(ROOT, "src", "." + path);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(body);
  } catch { res.writeHead(404).end("Not found"); }
}).listen(port, () => console.log(`Atlas preview at http://localhost:${port}`));
