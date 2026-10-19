// End-to-end-ish: drives the real default export's fetch() directly. Only
// covers the unauthenticated path here — it needs no network call (no
// Access JWT header means verifyAccess() returns null before ever touching
// the JWKS endpoint), so it's safe to run with no network access in CI.
// The authenticated paths (valid Access JWT, service token, Managed OAuth)
// are covered by the parity script against the real deployment instead —
// minting a JWT Cloudflare's real signing key would accept isn't something
// a unit test can do.
import { describe, expect, it } from "vitest";
import { exports as workerExports } from "cloudflare:workers";

// `exports.default` is a `Fetcher`-shaped binding to this Worker's default
// export (same interface as `env.ASSETS`), not the raw
// `fetch(request, env, ctx)` handler — it accepts a bare URL string, as the
// examples in Cloudflare's docs do. `cloudflare:workers`'s `Exports` type
// isn't augmented with this without running `wrangler types` first (not
// part of this change), so cast it explicitly.
const worker = workerExports as unknown as { default: Fetcher };

describe("Worker fetch — no Access JWT", () => {
  // `exports.default.fetch()` is slow to warm up the first couple of times
  // it's called in a fresh test file (several seconds) regardless of URL —
  // a rough edge in this very new tooling (@cloudflare/vitest-plugin 1.4.x
  // on Vitest 4), not something this Worker's code is doing. It resolves
  // correctly once it does; the generous timeout is for that warm-up, not
  // because the Worker itself is slow (confirmed separately via `wrangler
  // dev` + curl in the parity report).
  it("403s a request for the site", { timeout: 20_000 }, async () => {
    const res = await worker.default.fetch("http://example.com/");
    expect(res.status).toBe(403);
  });

  it("403s a request for /mcp too — the JWT check runs before routing", { timeout: 20_000 }, async () => {
    const res = await worker.default.fetch("http://example.com/mcp", { method: "POST", body: "{}" });
    expect(res.status).toBe(403);
  });

  it("403s even a request for a static asset", async () => {
    const res = await worker.default.fetch("http://example.com/favicon.svg");
    expect(res.status).toBe(403);
  });
});
