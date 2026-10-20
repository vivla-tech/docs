import { describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet, type JWK } from "jose";
import { verifyAccessToken, accessDeniedResponse } from "../src/access";

async function makeKeyPairAndJwks() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const publicJwk = (await exportJWK(publicKey)) as JWK;
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  publicJwk.kid = "test-key";
  const jwks = createLocalJWKSet({ keys: [publicJwk] });
  return { privateKey, jwks };
}

describe("verifyAccessToken", () => {
  it("accepts a token signed for an allowed audience", async () => {
    const { privateKey, jwks } = await makeKeyPairAndJwks();
    const token = await new SignJWT({ email: "joaquin@vivla.com" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject("user-123")
      .setAudience("aud-prod")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    const identity = await verifyAccessToken(token, jwks, ["aud-prod", "aud-staging"]);
    expect(identity).toEqual({ sub: "user-123", email: "joaquin@vivla.com", aud: ["aud-prod"] });
  });

  it("accepts a token for the second configured audience (staging)", async () => {
    const { privateKey, jwks } = await makeKeyPairAndJwks();
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject("svc-token-456")
      .setAudience("aud-staging")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    const identity = await verifyAccessToken(token, jwks, ["aud-prod", "aud-staging"]);
    expect(identity?.sub).toBe("svc-token-456");
    expect(identity?.email).toBeUndefined();
  });

  it("rejects a token for an audience that isn't configured", async () => {
    const { privateKey, jwks } = await makeKeyPairAndJwks();
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject("user-123")
      .setAudience("some-other-app")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    expect(await verifyAccessToken(token, jwks, ["aud-prod"])).toBeNull();
  });

  it("rejects an expired token", async () => {
    const { privateKey, jwks } = await makeKeyPairAndJwks();
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject("user-123")
      .setAudience("aud-prod")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
      .sign(privateKey);

    expect(await verifyAccessToken(token, jwks, ["aud-prod"])).toBeNull();
  });

  it("rejects a token signed by a different key (wrong signature)", async () => {
    const { jwks } = await makeKeyPairAndJwks();
    const { privateKey: otherKey } = await generateKeyPair("RS256");
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject("user-123")
      .setAudience("aud-prod")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(otherKey);

    expect(await verifyAccessToken(token, jwks, ["aud-prod"])).toBeNull();
  });

  it("rejects a garbage token without throwing", async () => {
    const { jwks } = await makeKeyPairAndJwks();
    expect(await verifyAccessToken("not-a-jwt", jwks, ["aud-prod"])).toBeNull();
  });

  it("rejects when no audience is configured, even with a valid token", async () => {
    const { privateKey, jwks } = await makeKeyPairAndJwks();
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject("user-123")
      .setAudience("aud-prod")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    expect(await verifyAccessToken(token, jwks, [])).toBeNull();
  });
});

describe("accessDeniedResponse", () => {
  it("is a 403", async () => {
    const res = accessDeniedResponse();
    expect(res.status).toBe(403);
  });
});
