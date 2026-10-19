// Weighted Reciprocal Rank Fusion — combines any number of ranked lists
// (here: BM25's lexical ranking and the embeddings' cosine-similarity
// ranking) into one score per item, without needing the rankers' raw
// scores to be on comparable scales (BM25 scores and cosine similarities
// aren't). `k` and the per-ranking weights are tuned against the parity
// eval set — see _projects/wiki-self-hosted/parity/mcp-parity.md.
export function reciprocalRankFusion(rankings: string[][], weights: number[], k: number): Map<string, number> {
  const scores = new Map<string, number>();
  rankings.forEach((ranking, r) => {
    const weight = weights[r] ?? 1;
    ranking.forEach((key, i) => {
      const contribution = weight / (k + i + 1); // i is 0-indexed; rank is i+1
      scores.set(key, (scores.get(key) ?? 0) + contribution);
    });
  });
  return scores;
}

/** Sorts fused scores into a plain ranked list of keys, best first. */
export function rankFromScores(scores: Map<string, number>): string[] {
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
}

/**
 * Re-sorts the top `topN` of a fused ranking by a weighted blend of its own
 * RRF score and an externally-supplied reranker score (both min-max
 * normalized over just that top-N window, since RRF scores and reranker
 * scores aren't on comparable scales either). `alpha` is the reranker's
 * weight (1 = reranker order only, 0 = unchanged RRF order). Keys beyond
 * `topN` keep their original RRF order — v3 never returns *fewer* usable
 * results than v2, it only re-orders the head of the list.
 *
 * `alpha`/`topN` were grid-searched on half the eval set
 * (scripts/evaluate-search.mjs) and landed on a conservative blend rather
 * than a hard override: a plain override (alpha=1 over a wide topN=20
 * window) measurably *hurt* the held-out test split — see the parity
 * report §2ter for the concrete regressions.
 */
export function blendRerank(fusedScores: Map<string, number>, rerankScores: Map<string, number>, topN: number, alpha: number): string[] {
  const ranked = rankFromScores(fusedScores);
  const top = ranked.slice(0, topN);
  const rest = ranked.slice(topN);
  if (top.length === 0) return ranked;

  const rrfVals = top.map((k) => fusedScores.get(k) as number);
  const rrfMin = Math.min(...rrfVals);
  const rrfMax = Math.max(...rrfVals);
  const rrfNorm = (k: string) => (rrfMax > rrfMin ? ((fusedScores.get(k) as number) - rrfMin) / (rrfMax - rrfMin) : 1);

  const rerankVals = top.map((k) => rerankScores.get(k) ?? 0);
  const rrMin = Math.min(...rerankVals);
  const rrMax = Math.max(...rerankVals);
  const rrNorm = (k: string) => (rrMax > rrMin ? ((rerankScores.get(k) ?? 0) - rrMin) / (rrMax - rrMin) : 0);

  const blended = top.map((key) => ({ key, score: alpha * rrNorm(key) + (1 - alpha) * rrfNorm(key) }));
  blended.sort((a, b) => b.score - a.score);
  return [...blended.map((b) => b.key), ...rest];
}
