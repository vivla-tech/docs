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

/** Formats one result exactly like Mintlify's: `Title/Link/Page/Content` text block. */
function formatResult(doc: SearchDoc, baseUrl: string): string {
  const link = doc.anchor ? `${baseUrl}/${doc.page}#${doc.anchor}` : `${baseUrl}/${doc.page}`;
  return `Title: ${doc.heading}\nLink: ${link}\nPage: ${doc.page}\nContent: ${doc.content}`;
}

export async function searchDocs(query: string, baseUrl: string): Promise<string[]> {
  const db = await getIndex();
  const { hits } = await oramaSearch(db, {
    term: query,
    properties: ["heading", "pageTitle", "content"],
    boost: { heading: 3, pageTitle: 2, content: 1 },
    limit: RESULT_LIMIT,
  });

  if (hits.length === 0) return [`No results found for "${query}".`];
  return hits.map((hit) => formatResult(hit.document, baseUrl));
}
