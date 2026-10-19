// Dense side of search_vivla_docs's hybrid retrieval (decision D3 v2,
// triggered because the v1 BM25-only parity test fell to 8/40 against
// Mintlify — see _projects/wiki-self-hosted/parity/mcp-parity.md).
//
// Chunk embeddings are precomputed at build time (scripts/build-embeddings.mjs,
// run on the Mac against Workers AI via the `cf` CLI — inference only, no
// resource created) and bundled as a JSON module, same pattern as
// corpus.json. Each vector is int8-quantized with a per-vector scale to
// keep the bundle small; dequantized once per isolate into Float32Array.
import embeddingsData from "../generated/embeddings.json";

export interface QuantizedVector {
  scale: number;
  values: number[];
}

export interface EmbeddingsFile {
  model: string;
  dim: number;
  generatedAt: string;
  chunkCount: number;
  /** Keyed by `${page}#${anchor}` — stable across corpus.json and this file as long as both are built from the same corpus. */
  chunks: Record<string, QuantizedVector>;
}

export const embeddingsFile = embeddingsData as unknown as EmbeddingsFile;

export function chunkKey(page: string, anchor: string): string {
  return `${page}#${anchor}`;
}

let dequantized: Map<string, Float32Array> | null = null;

function getDequantized(): Map<string, Float32Array> {
  if (!dequantized) {
    const map = new Map<string, Float32Array>();
    for (const [key, q] of Object.entries(embeddingsFile.chunks)) {
      const arr = new Float32Array(q.values.length);
      for (let i = 0; i < q.values.length; i++) arr[i] = (q.values[i] ?? 0) * q.scale;
      map.set(key, arr);
    }
    dequantized = map;
  }
  return dequantized;
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

function norm(a: Float32Array): number {
  return Math.sqrt(dot(a, a)) || 1;
}

/** Every chunk ranked by cosine similarity to `queryVector`, best first. */
export function rankByCosineSimilarity(queryVector: number[]): Array<{ key: string; score: number }> {
  const q = Float32Array.from(queryVector);
  const qNorm = norm(q);
  const results: Array<{ key: string; score: number }> = [];
  for (const [key, vec] of getDequantized()) {
    results.push({ key, score: dot(q, vec) / (qNorm * norm(vec)) });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}
