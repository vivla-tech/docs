import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { submitFeedback } from "../src/feedback";
import type { Env } from "../src/env";

describe("submitFeedback", () => {
  it("inserts a row with the Access identity recorded", async () => {
    const typedEnv = env as unknown as Env;
    await submitFeedback(typedEnv, { sub: "user-1", email: "joaquin@vivla.com", aud: ["x"] }, {
      path: "/architecture",
      feedback: "the diagram is stale",
    });

    const row = await typedEnv.FEEDBACK.prepare(
      "SELECT path, feedback, access_identity, client_name FROM wiki_feedback WHERE feedback = ?1",
    )
      .bind("the diagram is stale")
      .first();

    expect(row).toMatchObject({
      path: "/architecture",
      feedback: "the diagram is stale",
      access_identity: "joaquin@vivla.com",
      client_name: null,
    });
  });

  it("falls back to the service-token subject when there's no email", async () => {
    const typedEnv = env as unknown as Env;
    await submitFeedback(typedEnv, { sub: "svc-token-abc", aud: ["x"] }, {
      path: "/tools/index",
      feedback: "machine-submitted feedback",
    });

    const row = await typedEnv.FEEDBACK.prepare("SELECT access_identity FROM wiki_feedback WHERE feedback = ?1")
      .bind("machine-submitted feedback")
      .first();
    expect(row).toMatchObject({ access_identity: "svc-token-abc" });
  });

  it("records null identity when the call is unauthenticated (shouldn't normally happen)", async () => {
    const typedEnv = env as unknown as Env;
    await submitFeedback(typedEnv, null, { path: "/index", feedback: "anon feedback" });
    const row = await typedEnv.FEEDBACK.prepare("SELECT access_identity FROM wiki_feedback WHERE feedback = ?1")
      .bind("anon feedback")
      .first();
    expect(row).toMatchObject({ access_identity: null });
  });
});
