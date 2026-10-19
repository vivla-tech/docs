import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { bm25Ranking, searchDocs } from "../src/search";
import { embeddingsFile } from "../src/embeddings";
import type { Env } from "../src/env";

// The real AI binding has no local simulation (vitest.config.ts disables
// its remote proxy — this VPS has no Cloudflare auth, and shouldn't: real
// Workers AI calls for this project happen from the Mac's authenticated
// `cf` profile, see scripts/build-embeddings.mjs and
// scripts/evaluate-search.mjs). These tests mock env.AI.run() with a
// deterministic-but-meaningless vector — they check that the hybrid code
// path runs and formats output correctly, not retrieval quality. Quality
// (ground-truth hit@3/hit@5 for both Mintlify and ours, tuned RRF
// parameters) is measured by scripts/evaluate-search.mjs and reported in
// _projects/wiki-self-hosted/parity/mcp-parity.md.
function envWithFakeAI(): Env {
  const fakeVector = Array.from({ length: embeddingsFile.dim }, (_, i) => Math.sin(i));
  return {
    ...(env as unknown as Env),
    AI: { run: async () => ({ data: [fakeVector] }) } as unknown as Ai,
  };
}

describe("searchDocs (hybrid: BM25 + dense, fused with RRF)", () => {
  it("formats each hit as Title/Link/Page/Content", async () => {
    const [first] = await searchDocs(envWithFakeAI(), "llaves", "https://wiki.vivla.com");
    expect(first).toMatch(/^Title: .+\nLink: https:\/\/wiki\.vivla\.com\/\S+\nPage: \S+\nContent: [\s\S]+$/);
  });

  it("still returns results for a gibberish query — dense retrieval always has a nearest neighbor", async () => {
    // Unlike v1 (BM25-only), v2 doesn't have a clean "no results" concept:
    // cosine similarity ranks every chunk against the query embedding, so
    // there's always a closest one, however weak the match. The literal
    // "No results found" sentinel only fires when the hybrid path falls
    // back to BM25-only (a Workers AI failure) *and* BM25 itself finds
    // nothing — see the next describe block.
    const results = await searchDocs(envWithFakeAI(), "xyzzyplughsupercalifragilisticoinexistente", "https://wiki.vivla.com");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatch(/^Title: .+\nLink: /);
  });

  it("respects SITE_BASE_URL for the Link field", async () => {
    const [first] = await searchDocs(envWithFakeAI(), "reservas", "https://wiki-next.vivla.com");
    expect(first).toContain("Link: https://wiki-next.vivla.com/");
  });

  it("falls back to BM25-only when the AI binding fails", async () => {
    const brokenEnv = { ...(env as unknown as Env), AI: { run: async () => { throw new Error("boom"); } } as unknown as Ai };
    const results = await searchDocs(brokenEnv, "llaves", "https://wiki.vivla.com");
    expect(results.length).toBeGreaterThan(0); // BM25 alone still finds "llaves"
  });
});

describe("bm25Ranking (lexical side alone — no AI binding involved)", () => {
  it("returns no candidates for a run-on token the tokenizer can't split into real words", async () => {
    const ranking = await bm25Ranking("xyzzyplughsupercalifragilisticoinexistente");
    expect(ranking).toEqual([]);
  });

  it("ranks the right page first for a rare proper noun", async () => {
    // tools/chat/copilot.mdx's intro chunk is titled "Fabián, el copiloto
    // de CX" — the most distinctive, reliable case for lexical matching
    // alone (see src/search.ts's comment on prefix-matching noise).
    const ranking = await bm25Ranking("Fabián");
    expect(ranking[0]).toBe("tools/chat/copilot#");
  });
});
