#!/usr/bin/env node
// Exports, for every eval query, the top-N chunk candidates from v2's
// already-tuned hybrid fusion (fixed RRF params — this script does not
// retune them) along with their text, so a reranker call can be made for
// each query from the Mac (scripts/evaluate-search.mjs has no Cloudflare
// auth of its own, by design). Mirrors the BM25/dense/RRF logic in
// worker/src/search.ts and scripts/evaluate-search.mjs exactly, so the
// candidates reranked here are the same ones v3 would see in production.
//
// Usage: node export-rerank-candidates.mjs --corpus <corpus.json> --embeddings <embeddings.json> --query-embeddings <query-embeddings.json> --out <candidates.json> [--top-n 20] [--max-chars 600]
import { readFileSync, writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { create, insertMultiple, search as oramaSearch } from "@orama/orama";

function parseArgs(argv) {
  const out = { topN: 20, maxChars: 600 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--corpus") out.corpus = argv[++i];
    else if (a === "--embeddings") out.embeddings = argv[++i];
    else if (a === "--query-embeddings") out.queryEmbeddings = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--top-n") out.topN = Number(argv[++i]);
    else if (a === "--max-chars") out.maxChars = Number(argv[++i]);
  }
  return out;
}

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
function foldAccents(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function stripStopwords(query) {
  const tokens = query.split(/\s+/).filter(Boolean);
  const kept = tokens.filter((t) => !SPANISH_STOPWORDS.has(foldAccents(t.toLowerCase()).replace(/[.,;:!?¿¡"'()]/g, "")));
  return kept.length > 0 ? kept.join(" ") : query;
}
const CANDIDATE_POOL = 40;
// v2's already-tuned RRF params (scripts/evaluate-search.mjs's grid search) — fixed
// here on purpose: v3 reranks v2's candidates, it doesn't retune the retrieval stage.
const RRF_PARAMS = { k: 60, bm25Weight: 0.2, denseWeight: 1.0 };

function chunkKey(page, anchor) {
  return `${page}#${anchor}`;
}

async function buildBm25Index(corpus) {
  const schema = { key: "string", page: "string", heading: "string", pageTitle: "string", anchor: "string", content: "string" };
  const db = create({ schema, language: "spanish" });
  const docs = [];
  const docsByKey = new Map();
  for (const [path, page] of Object.entries(corpus.pages)) {
    for (const chunk of page.chunks) {
      const doc = { key: chunkKey(path, chunk.anchor), page: path, heading: chunk.title, pageTitle: page.title, anchor: chunk.anchor, content: chunk.content };
      docs.push(doc);
      docsByKey.set(doc.key, doc);
    }
  }
  await insertMultiple(db, docs);
  return { db, docsByKey };
}
async function bm25Ranking(db, query, limit = CANDIDATE_POOL) {
  const { hits } = await oramaSearch(db, {
    term: stripStopwords(query),
    properties: ["heading", "pageTitle", "content"],
    boost: { heading: 3, pageTitle: 2, content: 1 },
    limit,
  });
  return hits.map((h) => h.document.key);
}
function buildDenseIndex(embeddingsFile) {
  const vectors = new Map();
  for (const [key, q] of Object.entries(embeddingsFile.chunks)) {
    const bytes = Buffer.from(q.b64, "base64");
    const int8 = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const arr = new Float64Array(int8.length);
    for (let i = 0; i < int8.length; i++) arr[i] = int8[i] * q.scale;
    vectors.set(key, arr);
  }
  return vectors;
}
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
function norm(a) {
  return Math.sqrt(dot(a, a)) || 1;
}
function denseRanking(vectors, queryVector, limit = CANDIDATE_POOL) {
  const q = Float64Array.from(queryVector);
  const qNorm = norm(q);
  const results = [];
  for (const [key, vec] of vectors) results.push({ key, score: dot(q, vec) / (qNorm * norm(vec)) });
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit).map((r) => r.key);
}
function reciprocalRankFusion(rankings, weights, k) {
  const scores = new Map();
  rankings.forEach((ranking, r) => {
    const weight = weights[r] ?? 1;
    ranking.forEach((key, i) => {
      scores.set(key, (scores.get(key) ?? 0) + weight / (k + i + 1));
    });
  });
  return scores;
}
function rankFromScores(scores) {
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const corpus = JSON.parse(readFileSync(args.corpus, "utf8"));
  const embeddingsFile = JSON.parse(readFileSync(args.embeddings, "utf8"));
  const queryEmbeddings = JSON.parse(readFileSync(args.queryEmbeddings, "utf8"));

  const { db, docsByKey } = await buildBm25Index(corpus);
  const denseVectors = buildDenseIndex(embeddingsFile);

  const out = [];
  for (const entry of queryEmbeddings.queries) {
    const bm25Keys = await bm25Ranking(db, entry.q);
    const denseKeys = denseRanking(denseVectors, entry.vector);
    const fused = rankFromScores(reciprocalRankFusion([bm25Keys, denseKeys], [RRF_PARAMS.bm25Weight, RRF_PARAMS.denseWeight], RRF_PARAMS.k));
    const top = fused.slice(0, args.topN);
    const candidates = top.map((key) => {
      const doc = docsByKey.get(key);
      const text = `${doc.pageTitle} > ${doc.heading}\n${doc.content}`.slice(0, args.maxChars);
      return { key, page: doc.page, text };
    });
    out.push({ q: entry.q, pages: entry.pages, confidence: entry.confidence, candidates });
  }

  writeFileSync(args.out, JSON.stringify(out, null, 2), "utf8");
  console.log(`Exported rerank candidates for ${out.length} queries (top ${args.topN} each) -> ${args.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
