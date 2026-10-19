// Protocol-level contract test: drives the real McpServer over an in-memory
// transport (no HTTP, no Access) and checks tools/list matches
// mcp-tool-defs.json — the exact copy of Mintlify's captured tools-list.json
// — field for field. This is the one place a hand-typed description or a
// Zod-generated schema could quietly drift from the recorded contract.
import { describe, expect, it } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { createVivlaDocsServer } from "../src/mcp";
import toolDefs from "../src/mcp-tool-defs.json";
import type { Env } from "../src/env";

async function connect() {
  const server = createVivlaDocsServer(workerEnv as unknown as Env, null);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "contract-test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("tools/list", () => {
  it("returns exactly the three recorded tools, in the recorded shape", async () => {
    const client = await connect();
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual((toolDefs as { name: string }[]).map((t) => t.name).sort());

    for (const expected of toolDefs as Array<Record<string, unknown>>) {
      const actual = tools.find((t) => t.name === expected.name);
      expect(actual, `tool "${expected.name}" missing from tools/list`).toBeDefined();
      expect(actual?.description).toBe(expected.description);
      expect(actual?.title).toBe(expected.title);
      expect(actual?.inputSchema).toEqual(expected.inputSchema);
      expect(actual?.annotations).toEqual(expected.annotations);
    }
  });
});

describe("search_vivla_docs", () => {
  it("rejects extra properties (additionalProperties: false)", async () => {
    const client = await connect();
    // The SDK reports a schema-validation failure as an in-band tool error
    // (isError: true), not a protocol-level rejection — only an unknown
    // tool name or a transport fault rejects the call.
    const result = await client.callTool({ name: "search_vivla_docs", arguments: { query: "x", extra: "nope" } } as never);
    expect(result.isError).toBe(true);
  });

  it("falls back to the recorded 'no results' text when Workers AI is unavailable and BM25 finds nothing", async () => {
    // This test file's env has no usable AI binding (see test/search.test.ts
    // for why — no Cloudflare auth on this VPS, by design), so
    // search_vivla_docs exercises its fallback-to-BM25-only path here.
    // With a real AI binding, dense retrieval always has a nearest
    // neighbor and this sentinel doesn't fire — see search.test.ts's
    // "still returns results for a gibberish query" for that case.
    const client = await connect();
    const result = await client.callTool({
      name: "search_vivla_docs",
      arguments: { query: "xyzzyplughsupercalifragilisticoinexistente" },
    });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { text: string }).text).toBe(
      'No results found for "xyzzyplughsupercalifragilisticoinexistente".',
    );
  });
});

describe("query_docs_filesystem_vivla_docs", () => {
  it("runs a read-only command and shapes the output like Mintlify's sample", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "query_docs_filesystem_vivla_docs",
      arguments: { command: "ls /nope" },
    });
    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toBe("exit: 2\n--- stderr ---\nls: /nope: No such file or directory\n");
  });
});

describe("submit_feedback", () => {
  it("acknowledges with the recorded confirmation text", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "submit_feedback",
      arguments: { path: "/architecture", feedback: "test feedback from mcp-contract.test.ts" },
    });
    expect(result.content).toEqual([{ type: "text", text: "Feedback recorded. Thank you." }]);
  });
});

describe("resources/list", () => {
  it("still exposes the vivla skill resource at its original URI and name", async () => {
    const client = await connect();
    const { resources } = await client.listResources();
    const resource = resources.find((r) => r.uri === "mintlify://skills/vivla");
    expect(resource).toBeDefined();
    expect(resource?.name).toBe("vivla");
    expect(resource?.description).toMatch(/^Use when working with Vivla's co-ownership platform/);
  });

  it("serves non-empty markdown for that resource", async () => {
    const client = await connect();
    const { contents } = await client.readResource({ uri: "mintlify://skills/vivla" });
    expect(contents).toHaveLength(1);
    const [content] = contents;
    expect(content?.mimeType).toBe("text/markdown");
    expect("text" in (content ?? {}) ? String((content as { text: string }).text).length : 0).toBeGreaterThan(1000);
  });
});
