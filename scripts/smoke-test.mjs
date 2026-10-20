#!/usr/bin/env node
// Post-deploy smoke test for the vivla-wiki Worker.
//
// Usage: CF_ACCESS_CLIENT_ID=.. CF_ACCESS_CLIENT_SECRET=.. node smoke-test.mjs <base-url>
//
// Checks, against a live hostname behind Cloudflare Access:
//   1. anonymous requests never get content (401 or a redirect to Access);
//   2. with the service token, the home page and /architecture return 200;
//   3. /mcp tools/list returns the 3 tools of the Mintlify contract;
//   4. search_vivla_docs returns at least one page.
// Exits non-zero on the first failure. Never prints the token.
const base = (process.argv[2] || "").replace(/\/$/, "");
if (!base) throw new Error("usage: smoke-test.mjs <base-url>");
const id = process.env.CF_ACCESS_CLIENT_ID;
const secret = process.env.CF_ACCESS_CLIENT_SECRET;
if (!id || !secret) throw new Error("CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are required");
const auth = { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret };
const EXPECTED_TOOLS = ["query_docs_filesystem_vivla_docs", "search_vivla_docs", "submit_feedback"];

let failed = false;
function check(ok, label) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed = true;
}

async function mcp(method, params) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  const data = text.split("\n").find((l) => l.startsWith("data:"));
  return JSON.parse(data ? data.slice(5) : text);
}

const anon = await fetch(`${base}/`, { redirect: "manual" });
check(anon.status === 401 || (anon.status >= 300 && anon.status < 400 && (anon.headers.get("location") || "").includes("cloudflareaccess.com")), `anonymous / is blocked (${anon.status})`);

for (const path of ["/", "/architecture"]) {
  const res = await fetch(`${base}${path}`, { headers: auth });
  check(res.status === 200 && (await res.text()).includes("<title>"), `${path} returns 200 with the service token (${res.status})`);
}

const tools = ((await mcp("tools/list", {})).result?.tools ?? []).map((t) => t.name).sort();
check(JSON.stringify(tools) === JSON.stringify(EXPECTED_TOOLS), `tools/list = ${tools.join(", ")}`);

const search = await mcp("tools/call", { name: "search_vivla_docs", arguments: { query: "arquitectura de vivla-tools" } });
const hits = (search.result?.content ?? []).filter((c) => /^Page: /m.test(c.text ?? "")).length;
check(hits > 0, `search_vivla_docs returns ${hits} results`);

process.exit(failed ? 1 : 0);
