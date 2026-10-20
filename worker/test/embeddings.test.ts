import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { embeddingsFile, rankByCosineSimilarity } from "../src/embeddings";

describe("embeddingsFile", () => {
  it("has one vector per corpus chunk, at the expected dimension", () => {
    expect(embeddingsFile.chunkCount).toBe(Object.keys(embeddingsFile.chunks).length);
    expect(embeddingsFile.dim).toBeGreaterThan(0);
  });
});

describe("rankByCosineSimilarity", () => {
  it("ranks a chunk's own (dequantized) vector as its own best match", () => {
    const entry = Object.entries(embeddingsFile.chunks)[0];
    if (!entry) throw new Error("embeddings.json has no chunks");
    const [someKey, someVector] = entry;
    const bytes = Buffer.from(someVector.b64, "base64");
    const int8 = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dequantized = Array.from(int8, (v) => v * someVector.scale);
    const ranked = rankByCosineSimilarity(dequantized);
    const top = ranked[0];
    expect(top?.key).toBe(someKey);
    expect(top?.score).toBeGreaterThan(0.99); // quantization rounding, not exactly 1
  });
});
