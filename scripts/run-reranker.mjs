#!/usr/bin/env node
// Calls the Workers AI reranker (@cf/baai/bge-reranker-base by default) for
// each query's precomputed candidate list (scripts/export-rerank-candidates.mjs),
// via `cf ai run` (inference only — no resource created). One reranker call
// per query (the model takes one query + N contexts per call, unlike the
// embedding models which batch many independent texts).
//
// Usage: node run-reranker.mjs --candidates <candidates.json> --out <scores.json> [--model <model>] [--account-id <id>]
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

function parseArgs(argv) {
  const out = { model: "@cf/baai/bge-reranker-base", accountId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--candidates") out.candidates = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--model") out.model = argv[++i];
    else if (a === "--account-id") out.accountId = argv[++i];
  }
  if (!out.candidates || !out.out) throw new Error("Usage: --candidates <path> --out <path> [--model <id>] [--account-id <id>]");
  return out;
}

function main() {
  const { candidates: candidatesPath, out: outPath, model, accountId } = parseArgs(process.argv.slice(2));
  const entries = JSON.parse(readFileSync(candidatesPath, "utf8"));

  const env = { ...process.env };
  if (accountId) env.CLOUDFLARE_ACCOUNT_ID = accountId;
  const tmpDir = mkdtempSync(join(tmpdir(), "vivla-rerank-"));

  const out = [];
  let totalTokens = 0;
  const latencies = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const body = { query: entry.q, contexts: entry.candidates.map((c) => ({ text: c.text })) };
    const tmpFile = join(tmpDir, `q-${i}.json`);
    writeFileSync(tmpFile, JSON.stringify(body), "utf8");
    const start = Date.now();
    const raw = execFileSync("cf", ["ai", "run", model, "--body", `@${tmpFile}`], { env, maxBuffer: 1024 * 1024 * 16 });
    latencies.push(Date.now() - start);
    rmSync(tmpFile, { force: true });
    const parsed = JSON.parse(raw.toString("utf8"));
    if (parsed.usage?.total_tokens) totalTokens += parsed.usage.total_tokens;
    const scoresByKey = {};
    for (const r of parsed.response) {
      const cand = entry.candidates[r.id];
      if (cand) scoresByKey[cand.key] = r.score;
    }
    out.push({ q: entry.q, pages: entry.pages, confidence: entry.confidence, scores: scoresByKey });
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${entries.length}...`);
  }
  rmSync(tmpDir, { recursive: true, force: true });

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const pricePerMInputTokens = 0.00311;
  const estCostUsd = (totalTokens / 1_000_000) * pricePerMInputTokens;

  writeFileSync(outPath, JSON.stringify({ model, generatedAt: new Date().toISOString(), queries: out }), "utf8");
  console.log(`Reranked ${out.length} queries with ${model} -> ${outPath}`);
  console.log(`Latency (CLI-proxy, upper bound): p50=${p50}ms p95=${p95}ms`);
  console.log(`Total tokens: ${totalTokens}, est. cost: $${estCostUsd.toFixed(4)} ($${(estCostUsd / out.length).toFixed(8)}/query)`);
}

main();
