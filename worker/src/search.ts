// search_vivla_docs backend: hybrid retrieval (decision D3, v2) — Orama BM25
// (Spanish tokenizer) fused with dense cosine similarity over precomputed
// Workers AI embeddings, combined with weighted Reciprocal Rank Fusion.
//
// v1 (BM25-only) measured 8/40 (20%) query-overlap against the live
// Mintlify server — well under the plan's 80% gate — because BM25's prefix
// matching loses natural-language questions to vocabulary mismatch. See
// _projects/wiki-self-hosted/parity/mcp-parity.md for the full comparison,
// including v1 vs. v2 and the ground-truth hit-rate numbers the RRF
// parameters below were tuned against (holding out half the eval set).
import { create, insertMultiple, search as oramaSearch, type Orama } from "@orama/orama";
import { corpus, type Page } from "./content";
import { chunkKey, rankByCosineSimilarity } from "./embeddings";
import { reciprocalRankFusion, rankFromScores, blendRerank } from "./rrf";
import { rerankCandidates } from "./rerank";
import type { Env } from "./env";

const schema = {
  key: "string",
  page: "string",
  heading: "string",
  pageTitle: "string",
  anchor: "string",
  content: "string",
} as const;

type SearchDoc = {
  key: string;
  page: string;
  heading: string;
  pageTitle: string;
  anchor: string;
  content: string;
};

const docsByKey = new Map<string, SearchDoc>();
let dbPromise: Promise<Orama<typeof schema>> | null = null;

function buildDocs(): SearchDoc[] {
  const docs: SearchDoc[] = [];
  for (const [path, page] of Object.entries(corpus.pages) as Array<[string, Page]>) {
    for (const chunk of page.chunks) {
      const doc: SearchDoc = {
        key: chunkKey(path, chunk.anchor),
        page: path,
        heading: chunk.title,
        pageTitle: page.title,
        anchor: chunk.anchor,
        content: chunk.content,
      };
      docs.push(doc);
      docsByKey.set(doc.key, doc);
    }
  }
  return docs;
}

async function buildIndex(): Promise<Orama<typeof schema>> {
  const db = create({ schema, language: "spanish" });
  await insertMultiple(db, buildDocs());
  return db;
}

/** Built once per isolate on first call, then reused (cold-start budget, not per-request). */
function getIndex(): Promise<Orama<typeof schema>> {
  if (!dbPromise) dbPromise = buildIndex();
  return dbPromise;
}

const RESULT_LIMIT = 10;
// How many candidates each individual ranker contributes to the fusion —
// generous on purpose: a chunk that's #40 in one ranking and #1 in the
// other should still win, which a narrow top-10-per-ranker cutoff would
// prevent.
const CANDIDATE_POOL = 40;

// Reciprocal Rank Fusion parameters — chosen by scripts/evaluate-search.mjs's
// grid search on half the 40-query eval set (train split: hit@5 80%,
// hit@3 55%), reported against the held-out other half in the parity
// report. `bm25Weight`/`denseWeight` scale each ranking's contribution
// before the 1/(k+rank) falloff; `k` controls how fast that falloff is
// (larger k flattens the advantage of a #1 rank over a #5 rank). The
// fairly low bm25Weight reflects the grid search finding dense retrieval
// the stronger signal for this corpus/query mix — BM25 still matters: it's
// what makes rare proper nouns and exact technical terms win outright.
export const RRF_PARAMS = { k: 60, bm25Weight: 0.2, denseWeight: 1.0 };

// v3: reranks the top `topN` of the RRF fusion with a cross-encoder
// (src/rerank.ts), blended back in at weight `alpha` (see
// `blendRerank()` in src/rrf.ts). Both tuned by scripts/evaluate-search.mjs
// on half the 80-query eval set, held out the other half — a wide,
// hard-override rerank (topN=20, alpha=1) measurably hurt the held-out
// split, this conservative blend is what survived that test. See the
// parity report §2ter: it ties v2 on hit@5 and improves hit@3 slightly: a
// real but modest gain, not the fix that closes the gap to Mintlify.
export const RERANK_PARAMS = { topN: 5, alpha: 0.75 };
// How much chunk text goes into each reranker candidate — plenty for the
// cross-encoder's context window without ballooning the call's token cost.
const RERANK_CANDIDATE_CHARS = 600;

// Orama matches by prefix by default (not full-text exact), so a short
// grammatical word in a natural-language query — "de", "el", "se" — matches
// every word that merely *starts with* it ("de" matches "deployment",
// "decoradores", "despliega"...) across 1,400+ chunks, burying the actually
// relevant hit under noise. (`exact: true` avoids this but breaks on a few
// accented words — the Spanish stemmer doesn't round-trip them the same way
// on the query side — so it's not a safe fix here.) Stripping common
// Spanish function words from the query before searching removes the worst
// of it; see the parity report for what's still left over on multi-word
// queries with ordinary content words. (Dense retrieval, added for v2,
// covers most of the remaining gap — see the report.)
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

/** The lexical ranking alone, as a list of chunk keys, best first. */
export async function bm25Ranking(query: string, limit = CANDIDATE_POOL): Promise<string[]> {
  const db = await getIndex();
  const { hits } = await oramaSearch(db, {
    term: stripStopwords(query),
    properties: ["heading", "pageTitle", "content"],
    boost: { heading: 3, pageTitle: 2, content: 1 },
    limit,
  });
  return hits.map((hit) => hit.document.key);
}

/** Embeds one query through the Workers AI binding (inference only — no resource created). */
export async function embedQuery(env: Env, query: string): Promise<number[]> {
  const result = (await env.AI.run(
    "@cf/baai/bge-m3" as Parameters<Ai["run"]>[0],
    { text: [query] } as never,
  )) as { data?: number[][]; response?: number[][] };
  const vector = result.data?.[0] ?? result.response?.[0];
  if (!vector) throw new Error("Workers AI returned no embedding for the query");
  return vector;
}

/** The dense ranking alone, as a list of chunk keys, best first. */
export function denseRanking(queryVector: number[], limit = CANDIDATE_POOL): string[] {
  return rankByCosineSimilarity(queryVector)
    .slice(0, limit)
    .map((r) => r.key);
}

export async function searchDocs(env: Env, query: string, baseUrl: string): Promise<string[]> {
  const bm25 = await bm25Ranking(query);

  let fusedKeys: string[];
  let fusedScores: Map<string, number> | null = null;
  try {
    const queryVector = await embedQuery(env, query);
    const dense = denseRanking(queryVector);
    fusedScores = reciprocalRankFusion([bm25, dense], [RRF_PARAMS.bm25Weight, RRF_PARAMS.denseWeight], RRF_PARAMS.k);
    fusedKeys = rankFromScores(fusedScores);
  } catch {
    // Workers AI hiccup (rare) — fall back to lexical-only rather than
    // failing the whole tool call.
    fusedKeys = bm25;
  }

  if (fusedScores) {
    try {
      const candidates = fusedKeys.slice(0, RERANK_PARAMS.topN).map((key) => {
        const doc = docsByKey.get(key) as SearchDoc;
        return { key, text: `${doc.pageTitle} > ${doc.heading}\n${doc.content}`.slice(0, RERANK_CANDIDATE_CHARS) };
      });
      const rerankScores = await rerankCandidates(env, query, candidates);
      fusedKeys = blendRerank(fusedScores, rerankScores, RERANK_PARAMS.topN, RERANK_PARAMS.alpha);
    } catch {
      // Reranker hiccup (rare) — keep the hybrid fusion's own order rather
      // than failing the whole tool call.
    }
  }

  const topKeys = fusedKeys.slice(0, RESULT_LIMIT);
  if (topKeys.length === 0) return [`No results found for "${query}".`];
  return topKeys.map((key) => formatResult(docsByKey.get(key) as SearchDoc, baseUrl));
}
