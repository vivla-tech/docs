#!/usr/bin/env node
// Embeds an arbitrary list of query strings via Workers AI, shelling out to
// `cf ai run` (inference only — no resource created), same technique as
// build-embeddings.mjs. Used to precompute the 40-query eval set's
// embeddings once (cheap — one batch call) so scripts/evaluate-search.mjs
// doesn't need `cf`/Cloudflare auth itself and can run on the VPS.
//
// Usage: node embed-queries.mjs --queries <eval-queries.json> --out <query-embeddings.json> [--model <model>] [--account-id <id>]
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

function parseArgs(argv) {
  const out = { queries: null, out: null, model: "@cf/baai/bge-m3", accountId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--queries") out.queries = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--model") out.model = argv[++i];
    else if (a === "--account-id") out.accountId = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!out.queries || !out.out) throw new Error("Usage: --queries <eval-queries.json> --out <path> [--model <id>] [--account-id <id>]");
  return out;
}

function main() {
  const { queries: queriesPath, out: outPath, model, accountId } = parseArgs(process.argv.slice(2));
  const evalSet = JSON.parse(readFileSync(queriesPath, "utf8")); // [{ q, pages, confidence }, ...]
  const texts = evalSet.map((e) => e.q);

  const tmpDir = mkdtempSync(join(tmpdir(), "vivla-embed-queries-"));
  const tmpFile = join(tmpDir, "batch.json");
  writeFileSync(tmpFile, JSON.stringify({ text: texts, truncate_inputs: true }), "utf8");

  const env = { ...process.env };
  if (accountId) env.CLOUDFLARE_ACCOUNT_ID = accountId;
  const raw = execFileSync("cf", ["ai", "run", model, "--body", `@${tmpFile}`], { env, maxBuffer: 1024 * 1024 * 64 });
  rmSync(tmpDir, { recursive: true, force: true });

  const parsed = JSON.parse(raw.toString("utf8"));
  if (!Array.isArray(parsed.data) || parsed.data.length !== texts.length) {
    throw new Error(`Unexpected cf ai run output (expected ${texts.length} vectors): ${raw.toString("utf8").slice(0, 500)}`);
  }

  const out = evalSet.map((entry, i) => ({ q: entry.q, pages: entry.pages, confidence: entry.confidence, vector: parsed.data[i] }));
  writeFileSync(outPath, JSON.stringify({ model, generatedAt: new Date().toISOString(), queries: out }), "utf8");
  console.log(`Embedded ${out.length} eval queries with ${model} -> ${outPath}`);
}

main();
