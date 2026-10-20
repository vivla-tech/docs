import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { bm25Ranking, searchDocs } from "../src/search";
import { embeddingsFile } from "../src/embeddings";
import type { Env } from "../src/env";

// The real AI binding has no local simulation (vitest.config.ts disables
// its remote proxy — this VPS has no Cloudflare auth, and shouldn't: real
// Workers AI calls for this project happen from the Mac's authenticated
// `cf` profile, see scripts/build-embeddings.mjs and
// scripts/evaluate-search.mjs). These tests mock env.AI.run() with
// deterministic-but-meaningless responses — they check that the hybrid +
// rerank code path runs and formats output correctly, not retrieval
// quality. Quality (ground-truth hit@3/hit@5 for both Mintlify and ours,
// tuned RRF/rerank parameters) is measured by scripts/evaluate-search.mjs
// and reported in _projects/wiki-self-hosted/parity/mcp-parity.md.
//
// env.AI.run() is called with two different models (the embedding model,
// then the reranker) — this fake dispatches on the model name so each gets
// a response shape it can actually parse, instead of one fixed response.
function envWithFakeAI(rerankScores?: number[]): Env {
  const fakeVector = Array.from({ length: embeddingsFile.dim }, (_, i) => Math.sin(i));
  return {
    ...(env as unknown as Env),
    AI: {
      run: async (model: unknown, body: unknown) => {
        if (model === "@cf/baai/bge-reranker-base") {
          const contexts = (body as { contexts: Array<{ text: string }> }).contexts;
          return { response: contexts.map((_, id) => ({ id, score: rerankScores?.[id] ?? 0 })) };
        }
        return { data: [fakeVector] };
      },
    } as unknown as Ai,
  };
}

describe("searchDocs (hybrid: BM25 + dense, fused with RRF, reranked — v3)", () => {
  it("formats each hit as Title/Link/Page/Content", async () => {
    const [first] = await searchDocs(envWithFakeAI(), "llaves", "https://wiki.vivla.com");
    expect(first).toMatch(/^Title: .+\nLink: https:\/\/wiki\.vivla\.com\/\S+\nPage: \S+\nContent: [\s\S]+$/);
  });

  it("still returns results for a gibberish query — dense retrieval always has a nearest neighbor", async () => {
    // Unlike v1 (BM25-only), v2/v3 don't have a clean "no results" concept:
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

  it("falls back to BM25-only when the AI binding fails entirely", async () => {
    const brokenEnv = { ...(env as unknown as Env), AI: { run: async () => { throw new Error("boom"); } } as unknown as Ai };
    const results = await searchDocs(brokenEnv, "llaves", "https://wiki.vivla.com");
    expect(results.length).toBeGreaterThan(0); // BM25 alone still finds "llaves"
  });

  it("still returns results when only the reranker call fails — keeps the hybrid fusion's order", async () => {
    const env2 = {
      ...(env as unknown as Env),
      AI: {
        run: async (model: unknown) => {
          if (model === "@cf/baai/bge-reranker-base") throw new Error("reranker boom");
          return { data: [Array.from({ length: embeddingsFile.dim }, (_, i) => Math.sin(i))] };
        },
      } as unknown as Ai,
    };
    const results = await searchDocs(env2, "llaves", "https://wiki.vivla.com");
    expect(results.length).toBeGreaterThan(0);
  });

  it("the reranker's own top candidate can outrank a weaker hybrid-fusion one within the reranked window", async () => {
    // With a neutral (all-zero) fake embedding response, BM25 alone drives
    // the fusion for "llaves" (see bm25Ranking's own test below) — giving a
    // reranker score that strongly favors a *different* candidate inside
    // the reranked top-N should move it ahead of BM25's own pick.
    const [first] = await searchDocs(envWithFakeAI([0.01, 0.99, 0.5, 0.5, 0.5]), "llaves", "https://wiki.vivla.com");
    const [firstUnreranked] = await searchDocs(envWithFakeAI([0, 0, 0, 0, 0]), "llaves", "https://wiki.vivla.com");
    // Not asserting a specific page (that's scripts/evaluate-search.mjs's
    // job) — just that a strongly-skewed reranker signal actually changes
    // the top result, proving the blend is wired in and has effect.
    expect(first).not.toBe(firstUnreranked);
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
