import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { bm25Ranking, searchDocs } from "../src/search";
import type { Env } from "../src/env";

const typedEnv = env as unknown as Env;

describe("searchDocs (hybrid: BM25 + dense, fused with RRF)", () => {
  it("finds the last-hour booking pages for a realistic Spanish query", async () => {
    const results = await searchDocs(typedEnv, "reservas de última hora", "https://wiki.vivla.com");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.includes("Page: operativa/reservas-ultima-hora"))).toBe(true);
  });

  it("formats each hit as Title/Link/Page/Content", async () => {
    const [first] = await searchDocs(typedEnv, "llaves", "https://wiki.vivla.com");
    expect(first).toMatch(/^Title: .+\nLink: https:\/\/wiki\.vivla\.com\/\S+\nPage: \S+\nContent: [\s\S]+$/);
  });

  it("links to a bare page URL (no #anchor) for an intro chunk", async () => {
    // tools/chat/copilot.mdx opens with "# Fabián, el copiloto de CX" and a
    // paragraph before its first `## ` heading — that intro text is its own
    // chunk, titled with the page's frontmatter title, no anchor.
    const results = await searchDocs(typedEnv, "Fabián, el copiloto de CX", "https://wiki.vivla.com");
    const introHit = results.find((r) => r.startsWith("Title: Fabián, el copiloto de CX\n"));
    expect(introHit).toBeDefined();
    expect(introHit).toContain("Link: https://wiki.vivla.com/tools/chat/copilot\n");
  });

  it("still returns results for a gibberish query — dense retrieval always has a nearest neighbor", async () => {
    // Unlike v1 (BM25-only), v2 doesn't have a clean "no results" concept:
    // cosine similarity ranks every chunk against the query embedding, so
    // there's always a closest one, however weak the match. The literal
    // "No results found" sentinel can still fire (see src/search.ts), but
    // only when the hybrid path falls back to BM25-only (e.g. a Workers AI
    // hiccup) — not reachable deterministically from a unit test.
    const results = await searchDocs(typedEnv, "xyzzyplughsupercalifragilisticoinexistente", "https://wiki.vivla.com");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatch(/^Title: .+\nLink: /);
  });

  it("respects SITE_BASE_URL for the Link field", async () => {
    const [first] = await searchDocs(typedEnv, "reservas", "https://wiki-next.vivla.com");
    expect(first).toContain("Link: https://wiki-next.vivla.com/");
  });
});

describe("bm25Ranking (lexical side alone)", () => {
  it("returns no candidates for a run-on token the tokenizer can't split into real words", async () => {
    const ranking = await bm25Ranking("xyzzyplughsupercalifragilisticoinexistente");
    expect(ranking).toEqual([]);
  });

  it("ranks real content for a distinctive term", async () => {
    const ranking = await bm25Ranking("Fabián");
    expect(ranking.length).toBeGreaterThan(0);
  });
});
