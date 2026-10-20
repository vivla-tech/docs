-- wiki_feedback: submit_feedback tool backend (decision D5 — keep the tool,
-- store locally, review by hand; no external message).
CREATE TABLE IF NOT EXISTS wiki_feedback (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  path TEXT NOT NULL,
  feedback TEXT NOT NULL,
  -- Which MCP client submitted it. NULL today: in stateless Streamable HTTP
  -- a tool call carries no `initialize`-era clientInfo to read back from.
  client_name TEXT,
  -- The Access identity (email for a human session, service-token subject
  -- for a machine) that made the request, if any.
  access_identity TEXT
);

CREATE INDEX IF NOT EXISTS wiki_feedback_created_at_idx ON wiki_feedback (created_at);
CREATE INDEX IF NOT EXISTS wiki_feedback_path_idx ON wiki_feedback (path);
