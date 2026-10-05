#!/usr/bin/env node
// Export the CEDS ↔ CTDL snapshot the site renders (data/atlas.json).
//
// Two ways to reach the EDUcore graph, picked by which env vars are set:
//   1. Direct Neo4j (preferred for builds):
//        NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, [NEO4J_DATABASE]
//      Use a read-only Aura user.
//   2. EDUcore MCP server (same tool the claude.ai artifact used):
//        EDUCORE_MCP_URL (default https://educore.org/mcp), EDUCORE_MCP_TOKEN
//      The token is an OAuth bearer token for the MCP server.
//
// Writes data/atlas.json. Exits non-zero if the graph is unreachable or the
// snapshot fails sanity checks, so a bad export never replaces a good one.

import { writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "data/atlas.json");
const CTDL = "['CTDL','CTDLASN','CTDLQData']";

export const QUERIES = {
  versions: `MATCH (r:DmeStandardRoot) WHERE r._source IN ['CEDS','CTDL','CTDLASN','CTDLQData']
    RETURN collect([r._source, coalesce(r.version,'')]) AS rows`,
  cedsClasses: `MATCH (c:ForgedNode {_source:'CEDS', role:'DmeClass'})
    WITH c ORDER BY c.name
    RETURN collect([c.name, coalesce(c.cedsId,''), coalesce(c.description,'')]) AS rows`,
  ceds: `MATCH (p:ForgedNode {_source:'CEDS', role:'DmeProperty'})
    WITH p ORDER BY p.path
    RETURN collect([p.path, coalesce(p.cedsId,''), coalesce(p.description,''), coalesce(p.dataType, p.rangeDatatype, '')]) AS rows`,
  ctdlClasses: `MATCH (c:ForgedNode {role:'DmeClass'}) WHERE c._source IN ${CTDL}
    OPTIONAL MATCH (c)-[:SUBCLASS_OF]->(s:ForgedNode)
    OPTIONAL MATCH (c)-[:HAS_PROPERTY]->(p)
    WITH c, collect(DISTINCT s.name)[0] AS parent, count(DISTINCT p) AS np ORDER BY c._source, c.name
    RETURN collect([c._source, c.name, coalesce(parent,''), np, coalesce(c.description,''), coalesce(c.uri, c._id, '')]) AS rows`,
  ctdl: `MATCH (p:ForgedNode {role:'DmeProperty'}) WHERE p._source IN ${CTDL}
    OPTIONAL MATCH (c:ForgedNode {role:'DmeClass'})-[:HAS_PROPERTY]->(p)
    WITH p, count(c) AS nc ORDER BY p._source, p.name
    RETURN collect([p._source, p.name, coalesce(p.path,''), nc, coalesce(p.description,''), coalesce(p.uri,'')]) AS rows`,
  matches: `MATCH (n:ForgedNode)-[m:EXACT_MATCH|CLOSE_MATCH]->(h:HubReference) WHERE n._source IN ${CTDL}
    OPTIONAL MATCH (h)-[:HAS_CEDS_PROPERTY]->(cp:ForgedNode)
    OPTIONAL MATCH (h)-[:HAS_CEDS_DOMAIN]->(cd:ForgedNode)
    OPTIONAL MATCH (h)-[:HAS_CEDS_VALUE]->(cv:ForgedNode)
    RETURN collect([n._source, n.role, n.name, coalesce(n.path,''), type(m), coalesce(m.confidence,0),
                    coalesce(cd.name,''), coalesce(cp.name,''), coalesce(cv.name,''), coalesce(cp.path,''),
                    coalesce(n.description,'')]) AS rows`,
};

/* ---------- transport: Neo4j ---------- */
async function neo4jRunner() {
  const { default: neo4j } = await import("neo4j-driver");
  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD),
    { disableLosslessIntegers: true }
  );
  await driver.verifyConnectivity();
  const database = process.env.NEO4J_DATABASE || undefined;
  return {
    mode: "neo4j",
    async run(query) {
      const { records } = await driver.executeQuery(query, {}, { database, routing: neo4j.routing.READ });
      return records.map((r) => r.toObject());
    },
    close: () => driver.close(),
  };
}

/* ---------- transport: MCP (streamable HTTP) ---------- */
async function mcpRunner() {
  const url = process.env.EDUCORE_MCP_URL || "https://educore.org/mcp";
  const token = process.env.EDUCORE_MCP_TOKEN;
  let session = null, id = 0;
  async function rpc(method, params, notify = false) {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    };
    if (session) headers["Mcp-Session-Id"] = session;
    const body = notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++id, method, params };
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (res.status === 401) throw new Error("MCP server rejected the token (401). Refresh EDUCORE_MCP_TOKEN.");
    if (!res.ok && res.status !== 202) throw new Error(`MCP ${method} failed: HTTP ${res.status} ${await res.text()}`);
    session = res.headers.get("mcp-session-id") || session;
    if (notify) return null;
    const text = await res.text();
    const type = res.headers.get("content-type") || "";
    let msg;
    if (type.includes("text/event-stream")) {
      for (const line of text.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const m = JSON.parse(line.slice(5));
        if (m.id === body.id) msg = m;
      }
    } else msg = JSON.parse(text);
    if (!msg) throw new Error(`MCP ${method}: no response`);
    if (msg.error) throw new Error(`MCP ${method}: ${msg.error.message}`);
    return msg.result;
  }
  await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "ceds-ctdl-atlas", version: "1.0.0" } });
  await rpc("notifications/initialized", {}, true);
  return {
    mode: "mcp",
    async run(query) {
      const r = await rpc("tools/call", { name: "cypherQuery", arguments: { query } });
      const text = (r.content || []).find((c) => c.type === "text")?.text ?? "";
      if (r.isError) throw new Error(text);
      try { return JSON.parse(text); } catch { throw new Error(`cypherQuery returned non-JSON: ${text.slice(0, 300)}`); }
    },
    close: async () => {},
  };
}

/* ---------- main ---------- */
export async function exportSnapshot({ log = console.log } = {}) {
  let runner;
  if (process.env.NEO4J_URI) runner = await neo4jRunner();
  else if (process.env.EDUCORE_MCP_TOKEN) runner = await mcpRunner();
  else throw new Error("No graph credentials. Set NEO4J_URI/NEO4J_USERNAME/NEO4J_PASSWORD or EDUCORE_MCP_TOKEN.");

  log(`Exporting from EDUcore via ${runner.mode}…`);
  const out = { generatedAt: new Date().toISOString(), source: runner.mode };
  try {
    for (const [key, q] of Object.entries(QUERIES)) {
      const t = Date.now();
      const rows = (await runner.run(q))?.[0]?.rows ?? [];
      out[key] = rows;
      log(`  ${key.padEnd(12)} ${String(rows.length).padStart(5)} rows  ${Date.now() - t} ms`);
    }
  } finally {
    await runner.close();
  }
  out.versions = Object.fromEntries(out.versions);

  // Sanity checks: refuse to overwrite a good snapshot with an empty one.
  const fail = [];
  if (out.ceds.length < 1000) fail.push(`only ${out.ceds.length} CEDS properties`);
  if (out.ctdl.length < 200) fail.push(`only ${out.ctdl.length} CTDL properties`);
  if (out.matches.length < 20) fail.push(`only ${out.matches.length} crosswalk edges`);
  if (fail.length) throw new Error(`Snapshot failed sanity checks: ${fail.join(", ")}`);

  await mkdir(dirname(OUT), { recursive: true });
  const tmp = OUT + ".tmp";
  await writeFile(tmp, JSON.stringify(out));
  await rename(tmp, OUT);
  log(`Wrote ${OUT} (CEDS ${out.versions.CEDS}, CTDL ${out.versions.CTDL})`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  exportSnapshot().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
}
