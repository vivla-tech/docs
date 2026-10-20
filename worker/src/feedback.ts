// submit_feedback backend: insert into D1, no external message (decision
// D5 — keep the tool and its contract, review the table by hand; no GitHub
// issue, no Slack post).
import type { Env } from "./env";
import type { AccessIdentity } from "./access";

export interface SubmitFeedbackInput {
  path: string;
  feedback: string;
}

export async function submitFeedback(
  env: Env,
  identity: AccessIdentity | null,
  input: SubmitFeedbackInput,
): Promise<void> {
  await env.FEEDBACK.prepare(
    `INSERT INTO wiki_feedback (id, created_at, path, feedback, client_name, access_identity)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(
      crypto.randomUUID(),
      new Date().toISOString(),
      input.path,
      input.feedback,
      null, // client_name: the MCP SDK doesn't expose the connecting client's declared name to tool handlers today.
      identity?.email ?? identity?.sub ?? null,
    )
    .run();
}
