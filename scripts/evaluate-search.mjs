#!/usr/bin/env node
// Evaluates v1 (BM25-only) and v2 (hybrid: BM25 + dense embeddings fused
// with RRF) against the live Mintlify MCP server, on the 40-query eval set
// (scripts/eval-queries.json). Reports two things for each: overlap with
// Mintlify's own top-5 pages (the original parity metric), and
// ground-truth hit@3/hit@5 (does the human-expected page show up in the
// top-3/top-5 *distinct* pages). Tunes the RRF k and per-ranker weights on
// half the eval set (train), reports the other half (test) plus all 40, to
// avoid reporting an overfit number.
//
// Needs @orama/orama (same BM25 config as worker/src/search.ts) and network
// access to the live Mintlify server — run on the VPS, not the Mac. Query
// embeddings are precomputed on the Mac (scripts/embed-queries.mjs, needs
// `cf` auth) and passed in; this script makes no Cloudflare API calls of
// its own.
//
// Usage: node evaluate-search.mjs --corpus <corpus.json> --embeddings <embeddings.json> --query-embeddings <query-embeddings.json> --service-token-file <path> --out <report.json>
import { readFileSync, writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { create, insertMultiple, search as oramaSearch } from "@orama/orama";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
  }
  return out;
}

// --- Same stopword list / BM25 config as worker/src/search.ts ---------
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

// --- Dense ranking: dequantize once, cosine similarity --------------------
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

// --- RRF (mirrors worker/src/rrf.ts) ---------------------------------------
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

function keysToPages(keys, docsByKey) {
  return keys.map((k) => docsByKey.get(k)?.page).filter(Boolean);
}
function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}
function hitAtK(rankedPages, groundTruthPages, k) {
  const topK = dedupe(rankedPages).slice(0, k);
  return groundTruthPages.some((gt) => topK.includes(gt));
}
function overlapTop5(pagesA, pagesB) {
  const topA = dedupe(pagesA).slice(0, 5);
  const topB = dedupe(pagesB).slice(0, 5);
  const setB = new Set(topB);
  return topA.filter((p) => setB.has(p)).length;
}

// --- Mintlify fetch ---------------------------------------------------
async function mintlifySearch(query, clientId, clientSecret) {
  const res = await fetch("https://wiki.vivla.com/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "CF-Access-Client-Id": clientId,
      "CF-Access-Client-Secret": clientSecret,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_vivla_docs", arguments: { query } } }),
  });
  const text = await res.text();
  const bodyText = text.startsWith("event:") ? (text.split("\n").find((l) => l.startsWith("data:")) ?? "").slice(5).trim() : text;
  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return [];
  }
  const items = json.result?.content ?? [];
  return items.map((item) => /^Page: (\S+)/m.exec(item.text ?? "")?.[1]).filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const corpus = JSON.parse(readFileSync(args.corpus, "utf8"));
  const embeddingsFile = JSON.parse(readFileSync(args.embeddings, "utf8"));
  const queryEmbeddings = JSON.parse(readFileSync(args["query-embeddings"], "utf8"));
  const tokenFileText = readFileSync(args["service-token-file"], "utf8");
  const clientId = tokenFileText.match(/^CF_ACCESS_CLIENT_ID=(.+)$/m)?.[1]?.trim();
  const clientSecret = tokenFileText.match(/^CF_ACCESS_CLIENT_SECRET=(.+)$/m)?.[1]?.trim();

  console.log(`Building BM25 index (${Object.keys(corpus.pages).length} pages)...`);
  const { db, docsByKey } = await buildBm25Index(corpus);
  console.log(`Dequantizing ${embeddingsFile.chunkCount} dense vectors...`);
  const denseVectors = buildDenseIndex(embeddingsFile);

  const entries = queryEmbeddings.queries; // [{ q, pages, confidence, vector }]
  console.log(`Fetching Mintlify's live results for ${entries.length} queries...`);
  const perQuery = [];
  for (const entry of entries) {
    const [bm25Keys, mintlifyPages] = await Promise.all([bm25Ranking(db, entry.q), mintlifySearch(entry.q, clientId, clientSecret)]);
    const denseKeys = denseRanking(denseVectors, entry.vector);
    perQuery.push({ q: entry.q, groundTruth: entry.pages, confidence: entry.confidence, bm25Keys, denseKeys, mintlifyPages });
  }

  // Deterministic train/test split: alternate so both halves mix the three
  // query sources (lola-T8, lola-T1/T2, hand-written) evenly.
  const train = perQuery.filter((_, i) => i % 2 === 0);
  const test = perQuery.filter((_, i) => i % 2 === 1);

  function scoreParams(set, k, bm25Weight, denseWeight) {
    let hit5 = 0;
    let hit3 = 0;
    for (const pq of set) {
      const fused = rankFromScores(reciprocalRankFusion([pq.bm25Keys, pq.denseKeys], [bm25Weight, denseWeight], k));
      const pages = keysToPages(fused, docsByKey);
      if (hitAtK(pages, pq.groundTruth, 5)) hit5++;
      if (hitAtK(pages, pq.groundTruth, 3)) hit3++;
    }
    return { hit5: hit5 / set.length, hit3: hit3 / set.length };
  }

  console.log("Tuning RRF parameters on the train half...");
  const kGrid = [10, 20, 40, 60, 100];
  const weightGrid = [0.2, 0.4, 0.6, 0.8, 1.0, 1.5, 2.0];
  let best = null;
  for (const k of kGrid) {
    for (const bm25Weight of weightGrid) {
      const { hit5, hit3 } = scoreParams(train, k, bm25Weight, 1.0);
      const score = hit5 * 2 + hit3; // prioritize hit@5, use hit@3 as tiebreak
      if (!best || score > best.score) best = { k, bm25Weight, denseWeight: 1.0, score, hit5, hit3 };
    }
  }
  console.log("Best on train:", best);

  function reportFor(set, label) {
    const v1 = { hit5: 0, hit3: 0 };
    const v2 = { hit5: 0, hit3: 0 };
    const mintlify = { hit5: 0, hit3: 0 };
    let overlapV1 = 0;
    let overlapV2 = 0;
    const rows = [];
    for (const pq of set) {
      const v1Pages = keysToPages(pq.bm25Keys, docsByKey);
      const fused = rankFromScores(reciprocalRankFusion([pq.bm25Keys, pq.denseKeys], [best.bm25Weight, best.denseWeight], best.k));
      const v2Pages = keysToPages(fused, docsByKey);
      const mPages = pq.mintlifyPages;

      if (hitAtK(v1Pages, pq.groundTruth, 5)) v1.hit5++;
      if (hitAtK(v1Pages, pq.groundTruth, 3)) v1.hit3++;
      if (hitAtK(v2Pages, pq.groundTruth, 5)) v2.hit5++;
      if (hitAtK(v2Pages, pq.groundTruth, 3)) v2.hit3++;
      if (hitAtK(mPages, pq.groundTruth, 5)) mintlify.hit5++;
      if (hitAtK(mPages, pq.groundTruth, 3)) mintlify.hit3++;
      overlapV1 += overlapTop5(v1Pages, mPages);
      overlapV2 += overlapTop5(v2Pages, mPages);

      rows.push({
        q: pq.q,
        groundTruth: pq.groundTruth,
        confidence: pq.confidence,
        mintlifyTop5: dedupe(mPages).slice(0, 5),
        v1Top5: dedupe(v1Pages).slice(0, 5),
        v2Top5: dedupe(v2Pages).slice(0, 5),
      });
    }
    const n = set.length;
    return {
      label,
      n,
      v1: { hit5: v1.hit5 / n, hit3: v1.hit3 / n },
      v2: { hit5: v2.hit5 / n, hit3: v2.hit3 / n },
      mintlify: { hit5: mintlify.hit5 / n, hit3: mintlify.hit3 / n },
      overlapV1Avg: overlapV1 / n,
      overlapV2Avg: overlapV2 / n,
      rows,
    };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    rrfParams: { k: best.k, bm25Weight: best.bm25Weight, denseWeight: best.denseWeight },
    train: reportFor(train, "train"),
    test: reportFor(test, "test"),
    all: reportFor(perQuery, "all-40"),
  };

  writeFileSync(args.out, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nWrote ${args.out}`);
  for (const split of [report.train, report.test, report.all]) {
    console.log(
      `\n[${split.label}] n=${split.n}\n` +
        `  hit@3  mintlify=${(split.mintlify.hit3 * 100).toFixed(0)}%  v1=${(split.v1.hit3 * 100).toFixed(0)}%  v2=${(split.v2.hit3 * 100).toFixed(0)}%\n` +
        `  hit@5  mintlify=${(split.mintlify.hit5 * 100).toFixed(0)}%  v1=${(split.v1.hit5 * 100).toFixed(0)}%  v2=${(split.v2.hit5 * 100).toFixed(0)}%\n` +
        `  overlap-with-mintlify (avg/5)  v1=${split.overlapV1Avg.toFixed(2)}  v2=${split.overlapV2Avg.toFixed(2)}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
