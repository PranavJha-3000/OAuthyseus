import dns from "node:dns/promises";
import net from "node:net";
import type { ProbeKind, ProbeResult } from "../types";

// Real, credential-free checks the agent can run against a provider.
// These are what lets a guide say "tested" instead of "the docs say so".

const UA = "OAuthyseus-probe/1.0 (+https://github.com/; read-only OAuth setup research)";
const TIMEOUT_MS = 10_000;

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("::ffff:127.");
}

// The agent picks the URLs, so treat them as untrusted: public https hosts only.
async function assertPublicHttps(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("only https URLs are probed");
  if (url.username || url.password) throw new Error("credentials in URL are not allowed");
  const host = url.hostname;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("private host");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error("private address");
  return url;
}

async function get(url: URL, redirect: RequestRedirect): Promise<Response> {
  return fetch(url, {
    redirect,
    headers: { "User-Agent": UA, Accept: "text/html,application/json;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
}

function titleOf(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

const LOGIN_HINT = /(sign[\s-]?in|log[\s-]?in|login|accounts\.|auth0|signin|sso|oauth\/authorize|identity)/i;

function result(kind: ProbeKind, url: string, partial: Omit<ProbeResult, "kind" | "url" | "at">): ProbeResult {
  return { kind, url, at: new Date().toISOString(), ...partial };
}

/** Load a page (docs or developer console) and report where it really lands. */
export async function probePage(rawUrl: string, kind: "page" | "console"): Promise<ProbeResult> {
  try {
    const url = await assertPublicHttps(rawUrl);
    const res = await get(url, "follow");
    const body = (await res.text()).slice(0, 200_000);
    const title = titleOf(body);
    const landed = res.url || url.toString();
    const movedHost = new URL(landed).host !== url.host;
    const loginWall = LOGIN_HINT.test(landed) || (kind === "console" && /sign in|log in/i.test(title ?? ""));
    let summary: string;
    if (!res.ok) summary = `HTTP ${res.status}${title ? ` ("${title}")` : ""}.`;
    else if (kind === "console" && loginWall)
      summary = `Console is live and sits behind sign-in: redirected to ${new URL(landed).host}${title ? ` ("${title}")` : ""}. An agent cannot go further without your account.`;
    else summary = `Loaded${movedHost ? ` after redirect to ${new URL(landed).host}` : ""}${title ? `: "${title}"` : ""}.`;
    return result(kind, rawUrl, { ok: res.ok, status: res.status, finalUrl: landed, summary });
  } catch (err) {
    return result(kind, rawUrl, { ok: false, status: null, finalUrl: null, summary: `Could not load: ${(err as Error).message}` });
  }
}

/** Fetch an OpenID Connect discovery document and list what it advertises. */
export async function probeDiscovery(issuerOrUrl: string): Promise<ProbeResult> {
  const target = issuerOrUrl.includes("/.well-known/")
    ? issuerOrUrl
    : `${issuerOrUrl.replace(/\/$/, "")}/.well-known/openid-configuration`;
  try {
    const url = await assertPublicHttps(target);
    const res = await get(url, "follow");
    if (!res.ok) {
      return result("oidc-discovery", target, { ok: false, status: res.status, finalUrl: res.url, summary: `No discovery document (HTTP ${res.status}). The provider may use plain OAuth 2.0 without OIDC.` });
    }
    const doc = (await res.json()) as Record<string, unknown>;
    const scopes = Array.isArray(doc.scopes_supported) ? (doc.scopes_supported as string[]).slice(0, 12).join(", ") : "not listed";
    const pkce = Array.isArray(doc.code_challenge_methods_supported) ? (doc.code_challenge_methods_supported as string[]).join(", ") : "not advertised";
    return result("oidc-discovery", target, {
      ok: true,
      status: res.status,
      finalUrl: res.url,
      summary: `Discovery document found. authorization_endpoint=${doc.authorization_endpoint ?? "?"}; token_endpoint=${doc.token_endpoint ?? "?"}; PKCE methods: ${pkce}; scopes: ${scopes}.`,
    });
  } catch (err) {
    return result("oidc-discovery", target, { ok: false, status: null, finalUrl: null, summary: `Could not read discovery document: ${(err as Error).message}` });
  }
}

/**
 * Hit the authorize endpoint with a deliberately fake client_id. A live endpoint answers with
 * a recognisable error ("invalid_client", "app not found") or a login redirect. This proves the
 * endpoint exists and shows what an unregistered app sees, without creating anything.
 */
export async function probeAuthorize(authorizeUrl: string): Promise<ProbeResult> {
  try {
    const url = await assertPublicHttps(authorizeUrl);
    url.searchParams.set("client_id", "oauthyseus-probe-unregistered");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", "https://example.com/oauth/callback");
    url.searchParams.set("state", "probe");
    const res = await get(url, "manual");
    const location = res.headers.get("location");
    const body = res.status >= 300 && res.status < 400 ? "" : (await res.text()).slice(0, 100_000);
    const errMatch =
      (location && /[?&#]error=([^&]+)/.exec(location)?.[1]) ||
      body.match(/(invalid[_\s]client|invalid_request|unauthorized_client|client[_\s]id[^<]{0,60}(invalid|not found|does not exist)|app(lication)? (not found|does not exist)|redirect_uri[^<]{0,60}(mismatch|invalid))/i)?.[0];
    let summary: string;
    if (errMatch) summary = `Endpoint is live and rejected the fake client as expected (${decodeURIComponent(errMatch).slice(0, 80)}).`;
    else if (location) summary = `Endpoint is live; responded ${res.status} redirecting to ${new URL(location, url).host} (usually sign-in before client validation).`;
    else summary = `Endpoint answered HTTP ${res.status}${titleOf(body) ? ` ("${titleOf(body)}")` : ""}.`;
    return result("authorize-endpoint", authorizeUrl, { ok: res.status < 500, status: res.status, finalUrl: location, summary });
  } catch (err) {
    return result("authorize-endpoint", authorizeUrl, { ok: false, status: null, finalUrl: null, summary: `Could not reach endpoint: ${(err as Error).message}` });
  }
}
