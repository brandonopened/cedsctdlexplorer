# CEDS ↔ CTDL continuum atlas

Public, static website showing where CTDL and CEDS overlap and diverge across the
PK–career continuum, built from the EDUcore knowledge graph (Neo4j Aura, served at
educore.org/mcp). It began as a claude.ai artifact that queried the EDUcore
connector live; this repo is the standalone version.

## How it works
- `scripts/export.mjs` runs six Cypher queries against EDUcore and writes
  `data/atlas.json`. Transport is picked by env: `NEO4J_*` (direct, preferred) or
  `EDUCORE_MCP_TOKEN` (MCP streamable HTTP, `cypherQuery` tool). It refuses to
  overwrite the snapshot if counts fail sanity checks.
- `scripts/build.mjs` tries a fresh export, falls back to the committed
  `data/atlas.json` on failure, and assembles `dist/`.
- `src/` is plain HTML/CSS/JS with D3 7.9 from cdnjs. No framework, no bundler.
- Deployed as a Render static site (`render.yaml`). A GitHub Action hits the
  Render deploy hook nightly to refresh the snapshot.

## Commands
- `npm run export` — pull a snapshot (needs credentials in env or `.env` loaded by your shell)
- `npm run dev` — preview `src/` + `data/` at http://localhost:4173
- `npm run build && npm run preview` — build and serve `dist/`
- `npm run check` — syntax check

## Data contract (`data/atlas.json`)
Arrays, not objects, to keep the payload small. Column order is fixed by the
queries in `scripts/export.mjs` and destructured in `build()` in `src/app.js`;
change both together.
- `ceds`: `[path, cedsId, description, dataType]` — path is `Class.Property`
- `cedsClasses`: `[name, cedsId, description]`
- `ctdl`: `[source, name, path, hostClassCount, description, uri]`
- `ctdlClasses`: `[source, name, parentClass, propertyCount, description, uri]`
- `matches`: `[source, role, name, path, edgeType, confidence, cedsDomain, cedsProperty, cedsValue, cedsPropertyPath, description]`
- `versions`: `{CEDS, CTDL, CTDLASN, CTDLQData}`

## Graph conventions to respect
- Match on the forge contract: `(:ForgedNode {role, _source})`. `_source` values: `CEDS`, `CTDL`, `CTDLASN`, `CTDLQData`.
- Crosswalk = `EXACT_MATCH` (authored, trust as fact) or `CLOSE_MATCH` (inferred, scored) from a CTDL element to a CEDS `HubReference`; decompose via `HAS_CEDS_PROPERTY/DOMAIN/VALUE`.
- Never return `embedding` (1024-dim) in queries. Joining CEDS properties to classes by `parentId` timed out; splitting `path` is fast.
- Canonical base URL is educore.org (not ed-core.org or educore.tqtmp.org).

## Things that are deliberately heuristic
- Stage and topic are assigned by regex on class names in `stageOf()` / `topicOf()` at the top of `src/app.js`. They are not in the graph. Keep the footnote on the page saying so.
- CTDL properties attached to 10+ classes are pooled into one "Shared on many … types" group so each draws once.
- "CTDL only" means "no crosswalk edge in the graph", not "no equivalent concept". CTDL-ASN and CTDL-QData currently have zero edges, so they read entirely as gaps.

## State of the data (Oct 2026)
- CEDS 14.0.0.0: 402 classes, 2,324 properties.
- CTDL Release 20260327 (behind the live CTDL site), plus ASN 20230929 and QData 20260130: 557 properties.
- 113 CTDL properties have crosswalk edges, all CLOSE_MATCH; 26 option values are EXACT_MATCH (financial aid types).

## Open decisions
- Hostname (e.g. a subdomain of educore.org) and DNS.
- Credentials for builds: read-only Aura user vs MCP bearer token (token expiry makes MCP awkward for unattended builds).
- Whether to commit the snapshot (recommended: yes, as an outage fallback and a diffable record of crosswalk coverage over time).

## Working style
Validate structure before polishing. Keep analysis precise and separate strengths from gaps; no promotional framing on the page.
