import { describe, expect, it } from "vitest";
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
    const dequantized = someVector.values.map((v: number) => v * someVector.scale);
    const ranked = rankByCosineSimilarity(dequantized);
    const top = ranked[0];
    expect(top?.key).toBe(someKey);
    expect(top?.score).toBeGreaterThan(0.99); // quantization rounding, not exactly 1
  });
});
