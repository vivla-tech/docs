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
    const [someKey, someVector] = Object.entries(embeddingsFile.chunks)[0];
    const dequantized = someVector.values.map((v) => v * someVector.scale);
    const ranked = rankByCosineSimilarity(dequantized);
    expect(ranked[0].key).toBe(someKey);
    expect(ranked[0].score).toBeGreaterThan(0.99); // quantization rounding, not exactly 1
  });
});
