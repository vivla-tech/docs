// Dense side of search_vivla_docs's hybrid retrieval (decision D3 v2,
// triggered because the v1 BM25-only parity test fell to 8/40 against
// Mintlify — see _projects/wiki-self-hosted/parity/mcp-parity.md).
//
// Chunk embeddings are precomputed at build time (scripts/build-embeddings.mjs,
// run on the Mac against Workers AI via the `cf` CLI — inference only, no
// resource created) and bundled as a JSON module, same pattern as
// corpus.json. Each vector is int8-quantized with a per-vector scale,
// stored base64-encoded (not a JSON array of numbers — that costs ~3-4
// ASCII chars per value, barely smaller than float32 text; base64 over the
// raw bytes is ~2.3x smaller in practice) to keep the bundle small;
// dequantized once per isolate into Float32Array.
//
// Imported as size-balanced shards + a metadata file rather than one
// embeddings.json, same reason as src/content.ts: @cloudflare/vitest-plugin
// sends each imported module in a single WebSocket message to the workerd test
// runner, and a multi-MB module trips workerd's per-message limit ("Message is
// too large", 1009). Merged back here, losslessly. Keep this import list at
// SHARD_COUNT entries (scripts/lib/shard-record.mjs).
import { Buffer } from "node:buffer";
import embeddingsMeta from "../generated/embeddings-meta.json";
import embeddingsChunks0 from "../generated/embeddings-chunks-0.json";
import embeddingsChunks1 from "../generated/embeddings-chunks-1.json";
import embeddingsChunks2 from "../generated/embeddings-chunks-2.json";
import embeddingsChunks3 from "../generated/embeddings-chunks-3.json";
import embeddingsChunks4 from "../generated/embeddings-chunks-4.json";
import embeddingsChunks5 from "../generated/embeddings-chunks-5.json";
import embeddingsChunks6 from "../generated/embeddings-chunks-6.json";
import embeddingsChunks7 from "../generated/embeddings-chunks-7.json";

const embeddingsData = {
  ...embeddingsMeta,
  chunks: {
    ...embeddingsChunks0,
    ...embeddingsChunks1,
    ...embeddingsChunks2,
    ...embeddingsChunks3,
    ...embeddingsChunks4,
    ...embeddingsChunks5,
    ...embeddingsChunks6,
    ...embeddingsChunks7,
  },
};

export interface QuantizedVector {
  scale: number;
  /** Base64-encoded int8 bytes, `dim` of them. */
  b64: string;
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
      const bytes = Buffer.from(q.b64, "base64");
      const int8 = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const arr = new Float32Array(int8.length);
      for (let i = 0; i < int8.length; i++) arr[i] = (int8[i] ?? 0) * q.scale;
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
