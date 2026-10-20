import { describe, expect, it } from "vitest";
import { reciprocalRankFusion, rankFromScores, blendRerank } from "../src/rrf";

describe("reciprocalRankFusion", () => {
  it("ranks an item #1 in both lists above everything else", () => {
    const scores = reciprocalRankFusion([["a", "b", "c"], ["a", "c", "b"]], [1, 1], 60);
    expect(rankFromScores(scores)[0]).toBe("a");
  });

  it("lets a strong #1-in-one-list beat a weak #2-in-both", () => {
    // "x" is #1 in ranking 0 and absent from ranking 1; "y" is #2 in both.
    const scores = reciprocalRankFusion([["x", "y"], ["z", "y"]], [1, 1], 10);
    const ranked = rankFromScores(scores);
    expect(ranked[0]).toBe("y"); // appears in both lists, beats a single #1
  });

  it("respects relative weights", () => {
    // "a" is #1 only in ranking 0; "b" is #1 only in ranking 1. Weighting
    // ranking 1 higher should flip which one wins.
    const equal = reciprocalRankFusion([["a"], ["b"]], [1, 1], 60);
    expect(rankFromScores(equal).length).toBe(2); // tie, both present

    const weighted = reciprocalRankFusion([["a"], ["b"]], [0.1, 1], 60);
    expect(rankFromScores(weighted)[0]).toBe("b");
  });

  it("a larger k flattens the gap between rank 1 and rank 2 of the same list", () => {
    const smallK = reciprocalRankFusion([["a", "b"]], [1], 1);
    const gapSmallK = (smallK.get("a") ?? 0) - (smallK.get("b") ?? 0);

    const largeK = reciprocalRankFusion([["a", "b"]], [1], 1000);
    const gapLargeK = (largeK.get("a") ?? 0) - (largeK.get("b") ?? 0);

    expect(gapLargeK).toBeLessThan(gapSmallK);
  });

  it("rankFromScores sorts descending", () => {
    const scores = new Map([
      ["low", 0.1],
      ["high", 0.9],
      ["mid", 0.5],
    ]);
    expect(rankFromScores(scores)).toEqual(["high", "mid", "low"]);
  });
});

describe("blendRerank (search v3 — reranks the head of an RRF fusion)", () => {
  it("alpha=0 leaves the RRF order of the top-N window untouched", () => {
    const fused = new Map([
      ["a", 0.9],
      ["b", 0.5],
      ["c", 0.1],
    ]);
    const rerank = new Map([
      ["a", 0.01], // reranker disagrees with everything...
      ["b", 0.5],
      ["c", 0.99],
    ]);
    expect(blendRerank(fused, rerank, 3, 0)).toEqual(["a", "b", "c"]); // ...but alpha=0 ignores it
  });

  it("alpha=1 reorders the top-N window by the reranker score alone", () => {
    const fused = new Map([
      ["a", 0.9],
      ["b", 0.5],
      ["c", 0.1],
    ]);
    const rerank = new Map([
      ["a", 0.01],
      ["b", 0.5],
      ["c", 0.99],
    ]);
    expect(blendRerank(fused, rerank, 3, 1)).toEqual(["c", "b", "a"]);
  });

  it("only reorders the top-N window — items beyond it keep their RRF order and position", () => {
    const fused = new Map([
      ["a", 0.9],
      ["b", 0.5],
      ["c", 0.1],
      ["d", 0.05],
    ]);
    const rerank = new Map([
      ["a", 0.01],
      ["b", 0.99],
      // "c" has no reranker score at all — never submitted as a candidate
      // (e.g. topN cut it off before reranking ran).
    ]);
    const result = blendRerank(fused, rerank, 2, 1);
    expect(result).toEqual(["b", "a", "c", "d"]); // only a/b (the top 2) got reordered
  });

  it("a candidate missing from the reranker's response doesn't crash — it just scores as the weakest", () => {
    const fused = new Map([
      ["a", 0.9],
      ["b", 0.5],
    ]);
    const rerank = new Map([["a", 0.5]]); // "b" has no entry
    expect(blendRerank(fused, rerank, 2, 1)).toEqual(["a", "b"]);
  });
});
