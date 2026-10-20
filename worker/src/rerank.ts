// Cross-encoder reranking (search v3) — takes the top few candidates from
// v2's hybrid RRF fusion and re-scores each (query, chunk) pair directly,
// which catches cases BM25 + cosine similarity both miss (neither actually
// reads the chunk against the query the way a cross-encoder does). Scored
// with `@cf/baai/bge-reranker-base`, currently the only reranker Workers AI
// offers. See src/rrf.ts's `blendRerank()` for how the result is combined
// back with the RRF order, and the parity report §2ter for why it's a
// blend, not a hard override.
import type { Env } from "./env";

/** Runs the reranker over one query against a handful of candidate chunks. */
export async function rerankCandidates(env: Env, query: string, candidates: Array<{ key: string; text: string }>): Promise<Map<string, number>> {
  const result = (await env.AI.run("@cf/baai/bge-reranker-base" as Parameters<Ai["run"]>[0], {
    query,
    contexts: candidates.map((c) => ({ text: c.text })),
  } as never)) as { response?: Array<{ id: number; score: number }> };

  const scores = new Map<string, number>();
  for (const r of result.response ?? []) {
    const candidate = candidates[r.id];
    if (candidate) scores.set(candidate.key, r.score);
  }
  return scores;
}
