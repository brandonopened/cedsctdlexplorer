#!/usr/bin/env node
// Interactive export: get an EDUcore MCP token by browser login, then export.
//
// For local snapshot refreshes when you do not have Aura credentials. Registers
// a throwaway OAuth client, runs authorization-code + PKCE against ed-core.org,
// and hands the access token to exportSnapshot(). Unattended builds should use
// NEO4J_* instead — these tokens expire.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { exportSnapshot } from "./export.mjs";

const ISSUER = process.env.EDUCORE_ISSUER || "https://ed-core.org";
const PORT = Number(process.env.EDUCORE_AUTH_PORT || 8765);
const REDIRECT = `http://localhost:${PORT}/callback`;
// No offline_access: this is a one-shot export, and requesting it without
// prompt=consent makes the authorization server reject the resumed request.
const SCOPE = "openid dme:read";
const TIMEOUT_MS = Number(process.env.EDUCORE_AUTH_TIMEOUT_MS || 30 * 60_000);

// Best-effort; the URL is printed too, so a failure here is not fatal.
function openBrowser(url) {
  const [cmd, args] =
    // rundll32, not `cmd /c start`: cmd treats the & in the query string as a
    // command separator and truncates the URL at the first parameter.
    process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : process.platform === "darwin" ? ["open", [url]]
    : ["xdg-open", [url]];
  try { spawn(cmd, args, { stdio: "ignore", detached: true }).unref(); } catch {}
}
const b64url = (b) => b.toString("base64url");

const meta = await (await fetch(`${ISSUER}/.well-known/oauth-authorization-server`)).json();

const reg = await (await fetch(meta.registration_endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    client_name: "ceds-ctdl-atlas exporter",
    redirect_uris: [REDIRECT],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: SCOPE,
  }),
})).json();
if (!reg.client_id) throw new Error(`Client registration failed: ${JSON.stringify(reg)}`);

const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const state = b64url(randomBytes(16));
const authUrl = `${meta.authorization_endpoint}?${new URLSearchParams({
  client_id: reg.client_id,
  redirect_uri: REDIRECT,
  response_type: "code",
  scope: SCOPE,
  state,
  code_challenge: challenge,
  code_challenge_method: "S256",
  resource: "https://ed-core.org/mcp",
})}`;

const code = await new Promise((ok, fail) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url, REDIRECT);
    if (url.pathname !== "/callback") return res.writeHead(404).end();
    const err = url.searchParams.get("error");
    const errDesc = url.searchParams.get("error_description");
    const got = url.searchParams.get("code");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<body style="font:16px system-ui;padding:3rem">${err || !got ? "Authorization failed: " + err + (errDesc ? ": " + errDesc : "") : "Authorized. You can close this tab."}</body>`);
    server.close();
    err || !got ? fail(new Error(`Authorization failed: ${err || "no code"}${errDesc ? ": " + errDesc : ""}`))
      : url.searchParams.get("state") !== state ? fail(new Error("State mismatch"))
      : ok(got);
  });
  server.listen(PORT, () => {
    console.log(`\nOpening your browser to authorize. If nothing opens, visit:\n\n${authUrl}\n`);
    openBrowser(authUrl);
  });
  setTimeout(() => { server.close(); fail(new Error("Timed out waiting for authorization")); }, TIMEOUT_MS);
});

const tok = await (await fetch(meta.token_endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT,
    client_id: reg.client_id,
    code_verifier: verifier,
    resource: "https://ed-core.org/mcp",
  }),
})).json();
if (!tok.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(tok)}`);

process.env.EDUCORE_MCP_TOKEN = tok.access_token;
process.env.EDUCORE_MCP_URL = process.env.EDUCORE_MCP_URL || `${ISSUER}/mcp`;
delete process.env.NEO4J_URI;
await exportSnapshot();
