# CEDS ↔ CTDL continuum atlas

An interactive, zoomable map of every CEDS and CTDL class and property in the
[EDUcore](https://educore.org) knowledge graph, placed by PK–career stage and
topic. It highlights where CTDL crosswalks to CEDS and where CTDL describes
things CEDS does not.

## Quick start
```bash
npm install
cp .env.example .env        # add read-only Neo4j credentials (or an MCP token)
set -a; source .env; set +a
npm run export              # writes data/atlas.json
npm run dev                 # http://localhost:4173
```

No credentials? `npm run export:login` registers a throwaway OAuth client against
ed-core.org, opens a browser sign-in, and exports through the MCP `cypherQuery`
tool. The token it gets expires, so unattended builds still want `NEO4J_*`.

## Deploy (Render)
1. Push this repo to GitHub.
2. Render Dashboard → New → Blueprint → select the repo (uses `render.yaml`).
3. Set `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` on the service.
4. Optional nightly refresh: copy the service's Deploy Hook URL into the GitHub
   repo secret `RENDER_DEPLOY_HOOK`.

Builds fall back to the committed `data/atlas.json` if the graph is unreachable,
so commit a snapshot after your first export.

See `CLAUDE.md` for the data contract, graph conventions, and open decisions.
