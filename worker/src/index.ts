// Worker entry point. Every request goes through this (run_worker_first:
// true in wrangler.jsonc) in this order:
//   1. verify the Access JWT — 403 if missing/invalid (defense in depth;
//      Access itself is the primary gate in front of the hostname).
//   2. /mcp -> the MCP server (search_vivla_docs, query_docs_filesystem_
//      vivla_docs, submit_feedback — same names/schemas/output as Mintlify).
//   3. a known long-form path (e.g. /tools/index) -> 301 to its short
//      Starlight slug (/tools), or a docs.json redirect — see
//      src/redirects.ts for why this is done here rather than relying on
//      Workers Static Assets' own _redirects handling.
//   4. everything else -> the static site (env.ASSETS), falling back to
//      corpus-rendered /<page>.md, /llms.txt, /llms-full.txt when the
//      asset bundle doesn't have its own copy yet.
import { createMcpHandler } from "@modelcontextprotocol/server";
import { accessDeniedResponse, verifyAccess } from "./access";
import type { Env } from "./env";
import { createVivlaDocsServer } from "./mcp";
import { tryServeGeneratedPage } from "./pages";
import { resolveRedirect } from "./redirects";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const identity = await verifyAccess(request, env);
    if (!identity) return accessDeniedResponse();

    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      // A fresh handler (and a fresh McpServer, via the factory) per
      // request: stateless Streamable HTTP, no Durable Objects, and no
      // risk of one request's env/identity closure leaking into another
      // concurrent request on the same isolate.
      const handler = createMcpHandler(() => createVivlaDocsServer(env, identity));
      return handler.fetch(request);
    }

    const redirectTarget = resolveRedirect(url.pathname);
    if (redirectTarget) {
      const location = new URL(redirectTarget, url.origin);
      location.search = url.search;
      return Response.redirect(location.toString(), 301);
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status === 404) {
      const generated = tryServeGeneratedPage(url.pathname, env.SITE_BASE_URL);
      if (generated) return generated;
    }
    return assetResponse;
  },
} satisfies ExportedHandler<Env>;
