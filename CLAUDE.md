# CEDS ↔ CTDL hub atlas

Public, static website showing where CEDS and CTDL describe the same things
across the PK–career continuum, built from the EDUcore knowledge graph (Neo4j
Aura, served at educore.org/mcp). Since the educore-2026-10-30 manifest, CEDS
and CTDL are **peer hubs**: other standards ("spokes") are judged against each,
and neither hub is mapped onto the other. The atlas is built on that model.

## How it works
- `scripts/export.mjs` runs nine Cypher queries against EDUcore and writes
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
- `ctdl`: `[source, name, path, hostClassCount, description, uri]` — uri is the term CURIE (`ceterms:email`)
- `ctdlClasses`: `[source, name, parentClass, propertyCount, description, uri]`
- `hubUse`: `[hub, key, spokeSource, relation, elementCount]` — key is the CEDS path or CTDL CURIE
- `bridges`: `[spokeSource, elementName, elementPath, cedsPath, ctdlCurie, ctdlCardDomain, cedsRelation, cedsConfidence, ctdlRelation, ctdlConfidence]` — one spoke element on a card in each hub
- `declared`: `[ctdlSource, ctdlRole, ctdlName, ctdlScheme, ctdlUri, cedsRole, cedsName, cedsOptionSet, cedsUri, predicate, declaredBy, ctdlPropertyCuries[], cedsPropertyPaths[]]`
- `spokes`: `[source, family, version, title, totalProperties, toCeds, toCtdl, toBoth]`
- `versions`: `{CEDS, CTDL, CTDLASN, CTDLQData}`

## Graph conventions to respect
- Match on the forge contract: `(:ForgedNode {role, _source})`.
- Two hubs, CEDS and CTDL (core only; CTDL-ASN and CTDL-QData are ordinary standards with no edges). Match edges (`EXACT_MATCH|CLOSE_MATCH|BROAD_MATCH|NARROW_MATCH`) go from spoke elements to a `HubReference` carrying `hubName`. Decompose via `HAS_CEDS_*` / `HAS_CTDL_*`.
- **Hubs never chain.** A spoke element on a CEDS card and a CTDL card is co-coverage evidence, never a CEDS–CTDL mapping. Keep the two hops separate on the page and never combine their confidences.
- Every match edge is a judgment: read `mappingKind`, `mappingSource`, `matchBasis`. Exclude `bridge-debug`. Shared ground uses property-tier cards with `matchBasis = 'derived'` only.
- SIF and PESC carry edges on `HAS_INSTANCE` instances; roll up to the declaring `DmeProperty` before counting elements.
- The only direct CEDS–CTDL links are `DECLARED_CORRESPONDENCE` edges CTDL publishes (verbatim statements, not match edges).
- Never return `embedding` (1024-dim) in queries. The MCP endpoint refuses `CALL {}` subqueries.
- Canonical base URL is educore.org (not ed-core.org or educore.tqtmp.org).

## Things that are deliberately heuristic
- Stage and topic are assigned by regex on class names in `stageOf()` / `topicOf()` at the top of `src/app.js`. They are not in the graph. Keep the footnote on the page saying so.
- CTDL properties attached to 10+ classes are pooled into one "Shared on many … types" group so each draws once.
- Status precedence per hub property: published counterpart > shared ground (under the page's evidence settings) > used by spokes in this hub only > unused. "This hub only" means no spoke element there also lands in the other hub, not that the other hub lacks the concept.

## State of the data (Nov 2026, manifest educore-2026-10-30)
- CEDS 14.0.0.0: 402 classes, 2,324 properties. CTDL Release 20260927 (397 core properties), plus ASN 20260626 and QData 20260626.
- 22 spoke standards. 1,192 CEDS properties and 200 CTDL properties are used by at least one spoke.
- 2,179 spoke elements land on both hubs (2,205 rows); 297 CEDS–CTDL property pairs at the default setting (exact or close on both hops), 28 when both hops must be exact.
- 53 published CTDL→CEDS statements, all code values: 26 financial-aid types (owl:equivalentClass) and 27 support services (skos:narrowMatch / relatedMatch).
- The older inferred CTDL→CEDS crosswalk (113 CLOSE_MATCH + 26 EXACT_MATCH) no longer exists in the graph.

## Open decisions
- Hostname (e.g. a subdomain of educore.org) and DNS.
- Credentials for builds: read-only Aura user vs MCP bearer token (token expiry makes MCP awkward for unattended builds).
- Whether to commit the snapshot (recommended: yes, as an outage fallback and a diffable record of crosswalk coverage over time).

## Working style
Validate structure before polishing. Keep analysis precise and separate strengths from gaps; no promotional framing on the page.
