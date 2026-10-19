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
