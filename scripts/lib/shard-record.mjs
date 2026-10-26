// Splits the one big record field of a generated JSON artifact (corpus.pages,
// embeddings.chunks) into SHARD_COUNT size-balanced JSON files, plus a small
// "-meta.json" holding every other field.
//
// Why: the Worker statically imports these artifacts (src/content.ts,
// src/embeddings.ts) so they ship in the bundle. The Worker tests run inside
// workerd via @cloudflare/vitest-plugin, which sends each imported module's
// full source to the pool worker in a single WebSocket message. A module past
// workerd's per-message limit (~5–6 MB in practice) kills the socket with
// "WebSocket protocol error; statusCode 1009; Message is too large" /
// "Worker exited unexpectedly" — which is exactly what broke the Aggregate
// Docs deploy once the aggregated wiki grew (corpus.json crossed ~6 MB). The
// production bundle is fine either way (Worker script limit is 64 MiB
// uncompressed); this split is what keeps the TEST harness under its limit.
// Nothing is dropped: the Worker re-merges every shard at import.
//
// Keep SHARD_COUNT in sync with the import lists in src/content.ts and
// src/embeddings.ts. SHARD_COUNT bins give ~total/SHARD_COUNT per shard, so at
// 8 the corpus can grow several-fold before any one shard nears the limit.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const SHARD_COUNT = 8;

/**
 * @param {string} out   output directory (e.g. worker/generated)
 * @param {string} name  artifact base name (e.g. "corpus", "embeddings")
 * @param {object} data  the full artifact object
 * @param {string} field the record field to shard (e.g. "pages", "chunks")
 */
export function writeSharded(out, name, data, field) {
  const { [field]: record, ...meta } = data;
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${name}-meta.json`), JSON.stringify(meta), "utf8");

  // Greedy bin-packing: biggest entries first, each into the smallest bin so
  // far — gives even shards regardless of entry order or size spread.
  const bins = Array.from({ length: SHARD_COUNT }, () => ({ size: 0, obj: {} }));
  const sized = Object.entries(record)
    .map(([k, v]) => ({ k, v, size: JSON.stringify(v).length }))
    .sort((a, b) => b.size - a.size);
  for (const { k, v, size } of sized) {
    let bin = bins[0];
    for (const b of bins) if (b.size < bin.size) bin = b;
    bin.obj[k] = v;
    bin.size += size;
  }
  for (let i = 0; i < SHARD_COUNT; i++) {
    writeFileSync(join(out, `${name}-${field}-${i}.json`), JSON.stringify(bins[i].obj), "utf8");
  }
}
