import { describe, expect, it } from "vitest";
import { searchDocs } from "../src/search";

describe("searchDocs", () => {
  it("finds the last-hour booking pages for a realistic Spanish query", async () => {
    const results = await searchDocs("reservas de última hora", "https://wiki.vivla.com");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.includes("Page: operativa/reservas-ultima-hora"))).toBe(true);
  });

  it("formats each hit as Title/Link/Page/Content", async () => {
    const [first] = await searchDocs("llaves", "https://wiki.vivla.com");
    expect(first).toMatch(/^Title: .+\nLink: https:\/\/wiki\.vivla\.com\/\S+\nPage: \S+\nContent: [\s\S]+$/);
  });

  it("links to a bare page URL (no #anchor) for an intro chunk", async () => {
    // tools/chat/copilot.mdx opens with "# Fabián, el copiloto de CX" and a
    // paragraph before its first `## ` heading — that intro text is its own
    // chunk, titled with the page's frontmatter title, no anchor. Querying
    // a rare proper noun (rather than ordinary Spanish words, which Orama's
    // prefix matching ranks unreliably — see src/search.ts) reliably ranks
    // this exact chunk first.
    const results = await searchDocs("Fabián", "https://wiki.vivla.com");
    const introHit = results.find((r) => r.startsWith("Title: Fabián, el copiloto de CX\n"));
    expect(introHit).toBeDefined();
    expect(introHit).toContain("Link: https://wiki.vivla.com/tools/chat/copilot\n");
  });

  it("returns the recorded 'no results' sentence for a query that can't match", async () => {
    // A single run-on token (no separators) so the Spanish tokenizer can't
    // split it into real, individually-matchable Spanish/English words.
    const results = await searchDocs("xyzzyplughsupercalifragilisticoinexistente", "https://wiki.vivla.com");
    expect(results).toEqual(['No results found for "xyzzyplughsupercalifragilisticoinexistente".']);
  });

  it("respects SITE_BASE_URL for the Link field", async () => {
    const [first] = await searchDocs("reservas", "https://wiki-next.vivla.com");
    expect(first).toContain("Link: https://wiki-next.vivla.com/");
  });
});
