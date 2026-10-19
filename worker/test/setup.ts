// Defensive net around @cloudflare/vitest-plugin's own D1 migration
// auto-apply (configured via `migrations_dir` in wrangler.jsonc): the
// schema is idempotent (`CREATE TABLE IF NOT EXISTS`), so running it again
// here is a no-op if the plugin already applied it, and a fix if it didn't.
import { env } from "cloudflare:workers";
import type { Env } from "../src/env";

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS wiki_feedback (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  path TEXT NOT NULL,
  feedback TEXT NOT NULL,
  client_name TEXT,
  access_identity TEXT
);
`;

await (env as unknown as Env).FEEDBACK.exec(MIGRATION_SQL);
