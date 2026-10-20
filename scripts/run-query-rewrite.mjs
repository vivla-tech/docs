#!/usr/bin/env node
// Query rewriting (failure-analysis fix, step 3): rewrites each eval query
// into the technical vocabulary this corpus is actually written in
// (developer/ops docs, not a user-facing help center) before retrieval —
// targets the vocabulary-mismatch failures found by inspecting v3's
// concrete test misses (e.g. "me llegan muchos correos, quiero darme de
// baja" vs. the correct page's actual words: "suppressions", "preferences
// & unsubscribe", "RFC 8058"). One Workers AI chat call per query,
// inference only.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

function parseArgs(argv) {
  const out = { model: "@cf/meta/llama-3.1-8b-instruct-fp8", accountId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--queries") out.queries = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--model") out.model = argv[++i];
    else if (a === "--account-id") out.accountId = argv[++i];
  }
  return out;
}

const SYSTEM_PROMPT =
  "Reescribe la pregunta de un usuario final usando el vocabulario tecnico que usaria la documentacion interna " +
  "de desarrolladores de Vivla (nombres de sistemas, modulos o conceptos tecnicos probables), en español. " +
  "Devuelve SOLO la pregunta reescrita, una linea, sin explicaciones.";

function main() {
  const { queries: queriesPath, out: outPath, model, accountId } = parseArgs(process.argv.slice(2));
  const evalSet = JSON.parse(readFileSync(queriesPath, "utf8"));

  const env = { ...process.env };
  if (accountId) env.CLOUDFLARE_ACCOUNT_ID = accountId;
  const tmpDir = mkdtempSync(join(tmpdir(), "vivla-rewrite-"));

  const out = [];
  for (let i = 0; i < evalSet.length; i++) {
    const entry = evalSet[i];
    const body = { messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: entry.q }], max_tokens: 100 };
    const tmpFile = join(tmpDir, `q-${i}.json`);
    writeFileSync(tmpFile, JSON.stringify(body), "utf8");
    let rewritten = entry.q;
    try {
      const raw = execFileSync("cf", ["ai", "run", model, "--body", `@${tmpFile}`], { env, maxBuffer: 1024 * 1024 * 4 });
      const parsed = JSON.parse(raw.toString("utf8"));
      rewritten = (parsed.response ?? entry.q).trim() || entry.q;
    } catch (err) {
      console.error(`  query ${i} failed, keeping original: ${err.message}`);
    }
    rmSync(tmpFile, { force: true });
    out.push({ q: entry.q, pages: entry.pages, confidence: entry.confidence, rewritten });
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${evalSet.length}...`);
  }
  rmSync(tmpDir, { recursive: true, force: true });

  writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`Rewrote ${out.length} queries with ${model} -> ${outPath}`);
}

main();
