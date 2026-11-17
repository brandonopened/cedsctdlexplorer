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
// Standards that are neither hub nor CTDL module: the "spokes" judged against
// both hubs. UseCase is a use-case corpus, not a data standard.
const NOT_SPOKE = "['CEDS','CTDL','CTDLASN','CTDLQData','UseCase']";
const REL = "EXACT_MATCH|CLOSE_MATCH|BROAD_MATCH|NARROW_MATCH";
// A CEDS hub card names its property by path (Class.Property); a CTDL card by
// the term CURIE, which is also the CTDL property node's uri.
const CEDS_KEY = "coalesce(cp.path, h.domainName + '.' + h.propertyName)";

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

  // Spoke usage of each hub property: how many elements of each spoke standard
  // a judge mapped onto it, by relation. SIF and PESC carry their edges on
  // HAS_INSTANCE instances; roll those up to the declaring element.
  hubUse: `MATCH (x:ForgedNode)-[m:${REL}]->(h:HubReference {referenceTier:'property'})
    WHERE m.matchBasis = 'derived' AND m.mappingSource <> 'bridge-debug'
    OPTIONAL MATCH (d:ForgedNode {role:'DmeProperty'})-[:HAS_INSTANCE]->(x)
    OPTIONAL MATCH (h)-[:HAS_CEDS_PROPERTY]->(cp)
    WITH h.hubName AS hub, CASE h.hubName WHEN 'CEDS' THEN ${CEDS_KEY} ELSE h.propertyKey END AS key,
         x._source AS std, type(m) AS rel, coalesce(d, x) AS e
    WITH hub, key, std, rel, count(DISTINCT e) AS n ORDER BY hub, key, std, rel
    RETURN collect([hub, key, std, rel, n]) AS rows`,

  // Shared spokes: one spoke element judged onto a card in EACH hub. This is
  // co-coverage evidence, not a CEDS-CTDL mapping (hubs never chain), so both
  // hops travel separately with their own relation and confidence.
  bridges: `MATCH (x:ForgedNode)-[a:${REL}]->(hc:HubReference {hubName:'CEDS', referenceTier:'property'})
    WHERE a.matchBasis = 'derived' AND a.mappingSource <> 'bridge-debug'
    MATCH (x)-[b:${REL}]->(ht:HubReference {hubName:'CTDL', referenceTier:'property'})
    WHERE b.matchBasis = 'derived' AND b.mappingSource <> 'bridge-debug'
    OPTIONAL MATCH (d:ForgedNode {role:'DmeProperty'})-[:HAS_INSTANCE]->(x)
    WITH coalesce(d, x) AS e, x, hc AS h, ht, a, b
    OPTIONAL MATCH (h)-[:HAS_CEDS_PROPERTY]->(cp)
    WITH x._source AS std, e, ${CEDS_KEY} AS cpath, ht.domainName AS tdom, ht.propertyKey AS tkey,
         type(a) AS ra, a.mappingConfidence AS ca, type(b) AS rb, b.mappingConfidence AS cb
    ORDER BY ca + cb DESC
    WITH std, e, cpath, tdom, tkey, collect([ra, ca, rb, cb])[0] AS r
    RETURN collect([std, e.name, coalesce(e.path, ''), cpath, tkey, tdom,
                    r[0], round(coalesce(r[1],0)*100)/100, r[2], round(coalesce(r[3],0)*100)/100]) AS rows`,

  // Correspondences Credential Engine publishes from CTDL terms to CEDS terms,
  // carried verbatim (DECLARED_CORRESPONDENCE is not a match edge). Rolled up
  // to the properties whose code lists hold each value.
  declared: `MATCH (a:ForgedNode)-[d:DECLARED_CORRESPONDENCE]->(b:ForgedNode)
    WHERE a._source IN ${CTDL} AND b._source = 'CEDS'
    OPTIONAL MATCH (as:ForgedNode)-[:HAS_VALUE]->(a)
    OPTIONAL MATCH (bs:ForgedNode)-[:HAS_VALUE]->(b)
    WITH a, b, d, as, coalesce(bs, b) AS os
    OPTIONAL MATCH (bp:ForgedNode {_source:'CEDS', role:'DmeProperty'})-[:HAS_OPTION_SET]->(os)
    OPTIONAL MATCH (ap:ForgedNode {role:'DmeProperty'})-[:HAS_OPTION_SET]->(as)
    WITH a, b, d, as, os, collect(DISTINCT bp.path) AS bps, collect(DISTINCT ap.uri) AS aps
    RETURN collect([a._source, a.role, a.name, coalesce(as.name,''), coalesce(a.uri,''),
                    b.role, b.name, coalesce(os.name,''), coalesce(b.uri,''),
                    d.sourcePredicate, coalesce(d.declaredBy,''), aps, bps]) AS rows`,

  // How much of each spoke standard reaches each hub (any tier, any basis).
  spokes: `MATCH (e:ForgedNode {role:'DmeProperty'}) WHERE NOT e._source IN ${NOT_SPOKE}
    OPTIONAL MATCH (e)-[:HAS_INSTANCE*0..1]->(x)-[m:${REL}]->(h:HubReference)
    WHERE m.mappingSource <> 'bridge-debug'
    WITH e._source AS std, e, collect(DISTINCT h.hubName) AS hubs
    WITH std, count(e) AS total,
         sum(CASE WHEN 'CEDS' IN hubs THEN 1 ELSE 0 END) AS toCeds,
         sum(CASE WHEN 'CTDL' IN hubs THEN 1 ELSE 0 END) AS toCtdl,
         sum(CASE WHEN 'CEDS' IN hubs AND 'CTDL' IN hubs THEN 1 ELSE 0 END) AS toBoth
    OPTIONAL MATCH (r:DmeStandardRoot {_source: std})
    WITH std, total, toCeds, toCtdl, toBoth, head(collect(r)) AS r ORDER BY std
    RETURN collect([std, coalesce(r.standardFamily, std), coalesce(r.version, ''), coalesce(r.standardName, r.name, std),
                    total, toCeds, toCtdl, toBoth]) AS rows`,
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
  if (out.bridges.length < 500) fail.push(`only ${out.bridges.length} shared-spoke rows`);
  if (out.hubUse.length < 1000) fail.push(`only ${out.hubUse.length} hub-usage rows`);
  if (out.spokes.length < 10) fail.push(`only ${out.spokes.length} spoke standards`);
  if (fail.length) throw new Error(`Snapshot failed sanity checks: ${fail.join(", ")}`);

  await mkdir(dirname(OUT), { recursive: true });
  const tmp = OUT + ".tmp";
  await writeFile(tmp, JSON.stringify(out));
  await rename(tmp, OUT);
  log(`Wrote ${OUT} (CEDS ${out.versions.CEDS}, CTDL ${out.versions.CTDL})`);
  return out;
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] || "")) {
  exportSnapshot().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
}
