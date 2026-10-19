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
    // operativa/reservas-ultima-hora.mdx opens with an H1 + blockquote before
    // its first `## ` heading — that intro text is its own chunk, titled
    // with the page's frontmatter title (not the in-body H1), no anchor.
    // Query on its most distinctive phrase: "estado actual" alone is too
    // common across the corpus to rank this one chunk into the top 10.
    const results = await searchDocs("No propone cambios ni modificaciones de T&C", "https://wiki.vivla.com");
    const introHit = results.find((r) => r.startsWith("Title: Reservas de última hora\n"));
    expect(introHit).toBeDefined();
    expect(introHit).toContain("Link: https://wiki.vivla.com/operativa/reservas-ultima-hora\n");
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
