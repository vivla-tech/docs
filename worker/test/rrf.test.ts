import { describe, expect, it } from "vitest";
import { reciprocalRankFusion, rankFromScores } from "../src/rrf";

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
