#!/usr/bin/env node
// Computes dense embeddings for every heading chunk in corpus.json using a
// Workers AI embedding model, shelling out to `cf ai run` (inference-only —
// no Vectorize/D1/Access resource ever gets created) so this never needs a
// bearer token of its own; `cf`'s stored auth profile handles that. This is
// the one build step meant to run on a machine with the `cf` CLI
// authenticated (the Mac, today) rather than the VPS — see
// worker/README.md for the full corpus+embeddings build sequence.
//
// Quantizes each vector to int8 with a per-vector symmetric scale to keep
// the Worker bundle small (121 pages / 1,437 chunks * 1024 dims: ~5.9MB as
// float32, ~1.5MB quantized).
//
// Zero npm dependencies on purpose, same reasoning as build-corpus.mjs.
//
// Usage: node build-embeddings.mjs --corpus <corpus.json> --out <embeddings.json> [--model <model>] [--account-id <id>] [--batch-size <n>] [--max-chars <n>] [--limit <n>]
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

function parseArgs(argv) {
  const out = {
    corpus: null,
    out: null,
    model: "@cf/baai/bge-m3",
    accountId: null,
    limit: Infinity,
    batchSize: 100,
    maxChars: 8000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--corpus") out.corpus = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--model") out.model = argv[++i];
    else if (a === "--account-id") out.accountId = argv[++i];
    else if (a === "--limit") out.limit = Number(argv[++i]);
    else if (a === "--batch-size") out.batchSize = Number(argv[++i]);
    else if (a === "--max-chars") out.maxChars = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!out.corpus || !out.out) {
    throw new Error("Usage: --corpus <path> --out <path> [--model <id>] [--account-id <id>] [--batch-size <n>] [--max-chars <n>] [--limit <n>]");
  }
  return out;
}

// Keep in sync with worker/src/embeddings.ts's chunkKey().
function chunkKey(page, anchor) {
  return `${page}#${anchor}`;
}

function embedBatch(model, texts, accountId, tmpDir) {
  const tmpFile = join(tmpDir, `batch-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(tmpFile, JSON.stringify({ text: texts, truncate_inputs: true }), "utf8");
  const env = { ...process.env };
  if (accountId) env.CLOUDFLARE_ACCOUNT_ID = accountId;
  const raw = execFileSync("cf", ["ai", "run", model, "--body", `@${tmpFile}`], {
    env,
    maxBuffer: 1024 * 1024 * 256,
  });
  rmSync(tmpFile, { force: true });
  const parsed = JSON.parse(raw.toString("utf8"));
  if (!Array.isArray(parsed.data)) {
    throw new Error(`Unexpected cf ai run output: ${raw.toString("utf8").slice(0, 500)}`);
  }
  return { vectors: parsed.data, meta: parsed.meta, shape: parsed.shape };
}

// Base64-encoded raw bytes, not a JSON array of numbers: a JSON array of
// small integers still costs ~3-4 ASCII chars per value (",-120" etc.),
// barely smaller than float32 text. Base64 over the actual int8 bytes is
// ~2.3x smaller in practice (measured: 1,437 chunks * 1,024 dims, 4.6MB ->
// 2.0MB) — matters because this file gets bundled straight into the
// Worker script.
function quantize(vec) {
  let max = 0;
  for (const v of vec) {
    const a = Math.abs(v);
    if (a > max) max = a;
  }
  const scale = max > 0 ? max / 127 : 1;
  const int8 = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) int8[i] = Math.max(-127, Math.min(127, Math.round(vec[i] / scale)));
  const b64 = Buffer.from(int8.buffer, int8.byteOffset, int8.byteLength).toString("base64");
  return { scale, b64 };
}

function main() {
  const { corpus: corpusPath, out: outPath, model, accountId, limit, batchSize, maxChars } = parseArgs(process.argv.slice(2));
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));

  const items = []; // { key, text }
  for (const [page, pg] of Object.entries(corpus.pages)) {
    for (const chunk of pg.chunks) {
      // Same text the BM25 index weighs: heading + content. `truncate_inputs:
      // true` covers the rare per-item overflow, but some models (e.g.
      // qwen3-embedding, 8192-token window) reject an oversized *batch*
      // outright rather than truncating — --max-chars/--batch-size exist to
      // work around that.
      const text = `${chunk.title}\n${chunk.content}`.slice(0, maxChars);
      items.push({ key: chunkKey(page, chunk.anchor), text });
    }
  }
  const limited = items.slice(0, limit);

  const tmpDir = mkdtempSync(join(tmpdir(), "vivla-embed-"));
  const chunks = {};
  let totalInputTokens = 0;
  let totalNeurons = 0;
  let dim = null;

  for (let i = 0; i < limited.length; i += batchSize) {
    const batch = limited.slice(i, i + batchSize);
    const { vectors, meta, shape } = embedBatch(model, batch.map((b) => b.text), accountId, tmpDir);
    if (shape) dim = shape[1];
    for (let j = 0; j < batch.length; j++) {
      chunks[batch[j].key] = quantize(vectors[j]);
    }
    if (meta?.cost_metric_value_1) totalInputTokens += meta.cost_metric_value_1;
    if (meta?.neurons) totalNeurons += meta.neurons;
    console.log(`  batch ${i}-${i + batch.length - 1}/${limited.length} ok (dim=${dim})`);
  }
  rmSync(tmpDir, { recursive: true, force: true });

  writeFileSync(
    outPath,
    JSON.stringify({
      model,
      dim,
      generatedAt: new Date().toISOString(),
      chunkCount: Object.keys(chunks).length,
      chunks,
    }),
    "utf8",
  );

  const pricePerMInputTokens = 0.0118; // USD, both bge-m3 and qwen3-embedding-0.6b at time of writing
  const estCostUsd = (totalInputTokens / 1_000_000) * pricePerMInputTokens;
  console.log(
    `Embedded ${Object.keys(chunks).length} chunks with ${model} (dim=${dim}): ~${totalInputTokens} input tokens, ~${totalNeurons.toFixed(4)} neurons, ~$${estCostUsd.toFixed(4)} -> ${outPath}`,
  );
}

main();
