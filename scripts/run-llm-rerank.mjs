#!/usr/bin/env node
// LLM-as-judge reranking (v4 ablation), inspired by vivla-atlas's
// rewrite.ts SYSTEM_RERANK prompt (Haiku there, Workers AI chat model
// here). Scores each candidate 0-10 via one chat completion per query —
// a different mechanism than v3's pretrained cross-encoder, testing
// whether an LLM's semantic judgment handles Spanish paraphrase better.
// Inference only (cf ai run), no resource created.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

function parseArgs(argv) {
  const out = { model: "@cf/meta/llama-3.1-8b-instruct-fp8", accountId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--candidates") out.candidates = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--model") out.model = argv[++i];
    else if (a === "--account-id") out.accountId = argv[++i];
  }
  return out;
}

const SYSTEM_RERANK =
  'Eres un reranker. Recibes una CONSULTA y una lista numerada de fragmentos candidatos. ' +
  "Puntua cada fragmento por su relevancia para responder la consulta, en escala 0 (irrelevante) a 10 (perfecto). " +
  'Devuelve SOLO un objeto JSON {"<indice>": <score>} con un score por cada indice recibido, sin texto extra.';

function buildUserPrompt(query, candidates) {
  const lines = candidates.map((c, i) => `${i}: ${c.text}`);
  return `CONSULTA: ${query}\n\n${lines.join("\n\n")}`;
}

function main() {
  const { candidates: candidatesPath, out: outPath, model, accountId } = parseArgs(process.argv.slice(2));
  const entries = JSON.parse(readFileSync(candidatesPath, "utf8"));

  const env = { ...process.env };
  if (accountId) env.CLOUDFLARE_ACCOUNT_ID = accountId;
  const tmpDir = mkdtempSync(join(tmpdir(), "vivla-llm-rerank-"));

  const out = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const latencies = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const body = {
      messages: [
        { role: "system", content: SYSTEM_RERANK },
        { role: "user", content: buildUserPrompt(entry.q, entry.candidates) },
      ],
      max_tokens: 256,
    };
    const tmpFile = join(tmpDir, `q-${i}.json`);
    writeFileSync(tmpFile, JSON.stringify(body), "utf8");
    const start = Date.now();
    let scores = {};
    try {
      const raw = execFileSync("cf", ["ai", "run", model, "--body", `@${tmpFile}`], { env, maxBuffer: 1024 * 1024 * 16 });
      latencies.push(Date.now() - start);
      const parsed = JSON.parse(raw.toString("utf8"));
      if (parsed.usage) {
        totalInputTokens += parsed.usage.prompt_tokens ?? 0;
        totalOutputTokens += parsed.usage.completion_tokens ?? 0;
      }
      const text = (parsed.response ?? "").trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      scores = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch (err) {
      console.error(`  query ${i} failed: ${err.message}`);
    }
    rmSync(tmpFile, { force: true });

    const scoresByKey = {};
    for (const [idxStr, score] of Object.entries(scores)) {
      const idx = Number(idxStr);
      const cand = entry.candidates[idx];
      if (cand && typeof score === "number") scoresByKey[cand.key] = score;
    }
    out.push({ q: entry.q, pages: entry.pages, confidence: entry.confidence, scores: scoresByKey });
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${entries.length}...`);
  }
  rmSync(tmpDir, { recursive: true, force: true });

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];

  writeFileSync(outPath, JSON.stringify({ model, generatedAt: new Date().toISOString(), queries: out }), "utf8");
  console.log(`LLM-reranked ${out.length} queries with ${model} -> ${outPath}`);
  console.log(`Latency (CLI-proxy, upper bound): p50=${p50}ms p95=${p95}ms`);
  console.log(`Input tokens: ${totalInputTokens}, output tokens: ${totalOutputTokens}`);
}

main();
