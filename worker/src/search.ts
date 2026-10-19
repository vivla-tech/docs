// search_vivla_docs backend: Orama full-text (BM25), Spanish tokenizer, over
// heading chunks of corpus.json (decision D3 — embeddings only if the parity
// test against Mintlify says lexical search isn't enough).
import { create, insertMultiple, search as oramaSearch, type Orama } from "@orama/orama";
import { corpus } from "./content";

const schema = {
  page: "string",
  heading: "string",
  pageTitle: "string",
  anchor: "string",
  content: "string",
} as const;

type SearchDoc = {
  page: string;
  heading: string;
  pageTitle: string;
  anchor: string;
  content: string;
};

let dbPromise: Promise<Orama<typeof schema>> | null = null;

async function buildIndex(): Promise<Orama<typeof schema>> {
  const db = create({ schema, language: "spanish" });
  const docs: SearchDoc[] = [];
  for (const [path, page] of Object.entries(corpus.pages)) {
    for (const chunk of page.chunks) {
      docs.push({
        page: path,
        heading: chunk.title,
        pageTitle: page.title,
        anchor: chunk.anchor,
        content: chunk.content,
      });
    }
  }
  await insertMultiple(db, docs);
  return db;
}

/** Built once per isolate on first call, then reused (cold-start budget, not per-request). */
function getIndex(): Promise<Orama<typeof schema>> {
  if (!dbPromise) dbPromise = buildIndex();
  return dbPromise;
}

const RESULT_LIMIT = 10;

// Orama matches by prefix by default (not full-text exact), so a short
// grammatical word in a natural-language query — "de", "el", "se" — matches
// every word that merely *starts with* it ("de" matches "deployment",
// "decoradores", "despliega"...) across 1,400+ chunks, burying the actually
// relevant hit under noise. (`exact: true` avoids this but breaks on a few
// accented words — the Spanish stemmer doesn't round-trip them the same way
// on the query side — so it's not a safe fix here.) Stripping common
// Spanish function words from the query before searching removes the worst
// of it; see the parity report for what's still left over on multi-word
// queries with ordinary content words.
const SPANISH_STOPWORDS = new Set(
  `el la los las un una unos unas de en a por para con sin sobre entre hasta desde hacia durante segun tras
   y o pero ni que si como cuando aunque porque pues
   yo tu tú el ella nosotros vosotros ellos ellas me te se nos os le les lo mi su nuestro vuestro
   este esta estos estas ese esa esos esas aquel aquella aquellos aquellas
   es son fue fueron era eran ha han habia esta estan soy eres somos sois
   muy mas menos tambien ya no si al del que cual cuales quien quienes cuyo`
    .split(/\s+/)
    .filter(Boolean),
);

function foldAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function stripStopwords(query: string): string {
  const tokens = query.split(/\s+/).filter(Boolean);
  const kept = tokens.filter((t) => !SPANISH_STOPWORDS.has(foldAccents(t.toLowerCase()).replace(/[.,;:!?¿¡"'()]/g, "")));
  return kept.length > 0 ? kept.join(" ") : query;
}

/** Formats one result exactly like Mintlify's: `Title/Link/Page/Content` text block. */
function formatResult(doc: SearchDoc, baseUrl: string): string {
  const link = doc.anchor ? `${baseUrl}/${doc.page}#${doc.anchor}` : `${baseUrl}/${doc.page}`;
  return `Title: ${doc.heading}\nLink: ${link}\nPage: ${doc.page}\nContent: ${doc.content}`;
}

export async function searchDocs(query: string, baseUrl: string): Promise<string[]> {
  const db = await getIndex();
  const { hits } = await oramaSearch(db, {
    term: stripStopwords(query),
    properties: ["heading", "pageTitle", "content"],
    boost: { heading: 3, pageTitle: 2, content: 1 },
    limit: RESULT_LIMIT,
  });

  if (hits.length === 0) return [`No results found for "${query}".`];
  return hits.map((hit) => formatResult(hit.document, baseUrl));
}
