// Verifies the `Cf-Access-Jwt-Assertion` header Cloudflare Access attaches to
// every request that already passed its own edge check — browser cookie
// session, service token, or (now that Managed OAuth is enabled on the
// "VIVLA Docs" Access app) an OAuth-issued bearer. Access validates all three
// kinds of credentials itself and forwards the same signed JWT header in
// every case; this Worker never looks at cookies or client-id/secret headers
// directly. See https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/
// ("The MCP server must validate the Access JWT sent in the Cf-Access-Jwt-Assertion header.")
//
// This check is defense in depth, not the primary gate: Access itself blocks
// unauthenticated requests to the hostname before they ever reach the
// Worker. It matters when something bypasses that — e.g. `workers_dev`
// turned back on by mistake, or a direct request to a custom domain Access
// doesn't know about.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Env } from "./env";

const HEADER = "Cf-Access-Jwt-Assertion";

export interface AccessIdentity {
  /** Subject — a user UUID for humans, the service token UUID for machines. */
  sub: string;
  /** Present for human (Auth0) sessions; absent for service tokens. */
  email?: string;
  aud: string[];
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let jwksTeamDomain: string | undefined;

function getJwks(teamDomain: string, fresh = false) {
  if (fresh || !jwks || jwksTeamDomain !== teamDomain) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksTeamDomain = teamDomain;
  }
  return jwks;
}

// Access mints a new JWT per request, so `nbf`/`iat` are "now" on the edge
// machine that signed it. A Worker clock a few ms behind made jose reject
// valid tokens with no tolerance (intermittent 403s right after deploys).
const CLOCK_TOLERANCE_SECONDS = 60;

// jose error codes that mean "could not get a usable key", not "bad token".
// A fresh key set and one retry fixes a stale cache or a failed certs fetch.
const KEY_ERRORS = new Set(["ERR_JWKS_NO_MATCHING_KEY", "ERR_JWKS_TIMEOUT", "ERR_JWKS_INVALID", "ERR_JOSE_GENERIC"]);

function errorCode(err: unknown): string {
  return typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "UNKNOWN";
}

function allowedAudiences(env: Env): string[] {
  return env.ACCESS_AUD.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Verifies an already-extracted token against a key resolver and an allowed
 * audience list. Split out from {@link verifyAccess} so tests can pass a
 * local JWKS instead of hitting Cloudflare's real one over the network.
 */
export async function verifyAccessToken(
  token: string,
  getKey: JWTVerifyGetKey,
  audience: string[],
): Promise<AccessIdentity | null> {
  const result = await verifyAccessTokenDetailed(token, getKey, audience);
  return result.identity;
}

async function verifyAccessTokenDetailed(
  token: string,
  getKey: JWTVerifyGetKey,
  audience: string[],
): Promise<{ identity: AccessIdentity | null; error?: string }> {
  if (audience.length === 0) return { identity: null, error: "NO_AUDIENCE" };
  try {
    const { payload } = await jwtVerify(token, getKey, { audience, clockTolerance: CLOCK_TOLERANCE_SECONDS });
    const aud = Array.isArray(payload.aud) ? payload.aud.map(String) : payload.aud ? [String(payload.aud)] : [];
    return {
      identity: {
        sub: typeof payload.sub === "string" ? payload.sub : "",
        email: typeof payload.email === "string" ? payload.email : undefined,
        aud,
      },
    };
  } catch (err) {
    return { identity: null, error: errorCode(err) };
  }
}

/** Returns the verified identity, or null if the request has no valid Access JWT. */
export async function verifyAccess(request: Request, env: Env): Promise<AccessIdentity | null> {
  const token = request.headers.get(HEADER);
  if (!token) return null;
  const audience = allowedAudiences(env);
  let result = await verifyAccessTokenDetailed(token, getJwks(env.ACCESS_TEAM_DOMAIN), audience);
  if (!result.identity && result.error && KEY_ERRORS.has(result.error)) {
    result = await verifyAccessTokenDetailed(token, getJwks(env.ACCESS_TEAM_DOMAIN, true), audience);
  }
  if (!result.identity) console.warn(`[access] JWT rejected: ${result.error}`);
  return result.identity;
}

export function accessDeniedResponse(): Response {
  return new Response("Forbidden\n", {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
