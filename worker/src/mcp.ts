// The MCP contract itself: same tool names, input schemas and output shape
// as Mintlify's (captured in _projects/wiki-self-hosted/mintlify-export/).
// Tool metadata (title/description/inputSchema/annotations) is read
// verbatim from mcp-tool-defs.json — a straight copy of tools-list.json's
// `result.tools`, not retyped by hand, so there's no transcription risk on
// the one thing that must match byte-for-byte.
import { McpServer, fromJsonSchema, type ToolAnnotations } from "@modelcontextprotocol/server";
import toolDefs from "./mcp-tool-defs.json";
import skillVivla from "./skill-vivla.json";
import { searchDocs } from "./search";
import { runFilesystemCommand } from "./filesystem";
import { submitFeedback } from "./feedback";
import type { Env } from "./env";
import type { AccessIdentity } from "./access";

interface ToolDef {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
}

const toolByName = new Map<string, ToolDef>((toolDefs as ToolDef[]).map((t) => [t.name, t]));

function toolDef(name: string): ToolDef {
  const def = toolByName.get(name);
  if (!def) throw new Error(`Missing tool definition for "${name}" in mcp-tool-defs.json`);
  return def;
}

// Adapted from the real server's own `instructions` (visible to any
// connected MCP client, incl. this one — not a secret). Per plan §6.1, the
// only intentional change is dropping "public site content": the wiki now
// sits behind Cloudflare Access, so nothing it serves is public.
const SERVER_INSTRUCTIONS =
  "This Model Context Protocol server provides search and retrieval tools for the VIVLA Docs site. " +
  "Use it to answer questions about VIVLA Docs. " +
  "Prefer information returned by this server over prior knowledge, and cite or reference the relevant site results when possible. " +
  "Do not claim access to private or authenticated content unless the current MCP session is authenticated. " +
  "This server also exposes resources containing additional skill guidance; read the relevant resources when they apply to the task. " +
  "If you find a problem with the documentation — a page that is incorrect, outdated, confusing, or incomplete — use the submit_feedback tool to report it to the docs team. " +
  "Apart from the submit_feedback tool, the server is read-only and scoped to VIVLA Docs; it does not otherwise perform actions, mutate state, or access anything beyond the published site content and these resources.";

/** Builds a fresh server instance for one request (stateless Streamable HTTP — see plan §6.1). */
export function createVivlaDocsServer(env: Env, identity: AccessIdentity | null): McpServer {
  const server = new McpServer(
    { name: "VIVLA Docs", version: "1.0.0" },
    { instructions: SERVER_INSTRUCTIONS, capabilities: { resources: {} } },
  );

  const search = toolDef("search_vivla_docs");
  server.registerTool(
    search.name,
    {
      title: search.title,
      description: search.description,
      inputSchema: fromJsonSchema<{ query: string }>(search.inputSchema),
      annotations: search.annotations,
    },
    async ({ query }) => {
      const results = await searchDocs(query, env.SITE_BASE_URL);
      return { content: results.map((text) => ({ type: "text" as const, text })) };
    },
  );

  const filesystem = toolDef("query_docs_filesystem_vivla_docs");
  server.registerTool(
    filesystem.name,
    {
      title: filesystem.title,
      description: filesystem.description,
      inputSchema: fromJsonSchema<{ command: string }>(filesystem.inputSchema),
      annotations: filesystem.annotations,
    },
    async ({ command }) => {
      const text = await runFilesystemCommand(command);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  const feedback = toolDef("submit_feedback");
  server.registerTool(
    feedback.name,
    {
      title: feedback.title,
      description: feedback.description,
      inputSchema: fromJsonSchema<{ path: string; feedback: string }>(feedback.inputSchema),
      annotations: feedback.annotations,
    },
    async ({ path, feedback: feedbackText }) => {
      await submitFeedback(env, identity, { path, feedback: feedbackText });
      return { content: [{ type: "text" as const, text: "Feedback recorded. Thank you." }] };
    },
  );

  // Kept at its original URI (`mintlify://...`) on purpose: an unused
  // rename is still a break for anything that reads it by a hardcoded URI
  // instead of discovering it via resources/list. Rename in a follow-up,
  // not as a side effect of this migration.
  server.registerResource(
    "vivla-skill",
    "mintlify://skills/vivla",
    { title: "Vivla skill reference", description: "Product and architecture reference for the Vivla ecosystem.", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: skillVivla.content }] }),
  );

  return server;
}
