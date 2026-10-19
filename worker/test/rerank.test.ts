import { describe, expect, it } from "vitest";
import { rerankCandidates } from "../src/rerank";
import type { Env } from "../src/env";

function envWithFakeReranker(scoresInOrder: number[]): Env {
  return {
    AI: {
      run: async (_model: unknown, body: unknown) => {
        const contexts = (body as { contexts: Array<{ text: string }> }).contexts;
        return { response: contexts.map((_, id) => ({ id, score: scoresInOrder[id] ?? 0 })) };
      },
    } as unknown as Ai,
  } as unknown as Env;
}

describe("rerankCandidates", () => {
  it("maps the reranker's positional response back to candidate keys", async () => {
    const env = envWithFakeReranker([0.1, 0.9, 0.5]);
    const scores = await rerankCandidates(env, "llaves", [
      { key: "a#", text: "..." },
      { key: "b#", text: "..." },
      { key: "c#", text: "..." },
    ]);
    expect(scores.get("a#")).toBe(0.1);
    expect(scores.get("b#")).toBe(0.9);
    expect(scores.get("c#")).toBe(0.5);
  });

  it("returns an empty map rather than throwing when the model responds with nothing", async () => {
    const env = { AI: { run: async () => ({}) } as unknown as Ai } as unknown as Env;
    const scores = await rerankCandidates(env, "llaves", [{ key: "a#", text: "..." }]);
    expect(scores.size).toBe(0);
  });
});
