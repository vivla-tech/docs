#!/usr/bin/env node
// Builds the corpus the Worker (worker/) and the MCP serve from.
//
// Input: a checkout of the aggregated `docs` branch (docs.json + *.mdx at the
// repo root, subrepo content already merged into tools/, mobile/, panel/).
// In CI this script runs with cwd already on that checkout; for local/VPS
// testing pass --source pointing at a materialized copy of origin/docs.
//
// Output (--out, default worker/generated/):
//   corpus.json       — pages (title, description, body, heading chunks) +
//                        the nav tree + llms.txt / llms-full.txt templates,
//                        read by the Worker at runtime (bundled as a JSON
//                        module, no filesystem access needed in workerd).
//   llms.txt          — rendered copy, for inspection/diffing (BASE_URL =
//                        https://wiki.vivla.com).
//   llms-full.txt     — same, full page bodies inlined.
//   pages/<path>.md   — rendered copy of each page's `/<path>.md` form, for
//                        inspection/diffing.
//
// Zero npm runtime dependency except gray-matter (frontmatter is YAML with
// folded multi-line scalars in a few pages — not worth a hand-rolled parser).
//
// Usage: node build-corpus.mjs [--source <dir>] [--out <dir>] [--base-url <url>]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { source: process.cwd(), out: join(__dirname, "..", "worker", "generated"), baseUrl: "https://wiki.vivla.com" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--source") out.source = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--base-url") out.baseUrl = argv[++i].replace(/\/+$/, "");
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

// --- Heading-aware GitHub-slugger (adapted, ISC-licensed algorithm from the
// `github-slugger` npm package: https://github.com/Flet/github-slugger).
// Vendored instead of imported so this script stays dependency-light and so
// the Worker (which never runs this file) doesn't need it at all — anchors
// are precomputed here, once, at build time.
// eslint-disable-next-line no-control-regex, no-misleading-character-class
const SLUG_STRIP_RE = /[\0-\x1F!-,\.\/:-@\[-\^`\{-\xA9\xAB-\xB4\xB6-\xB9\xBB-\xBF\xD7\xF7]/g;

function slugify(value) {
  // Heading text may contain a single level of inline code span markup
  // (`` `like this` ``) — strip the backticks before slugifying, same as a
  // remark/rehype pipeline would (the slugger only ever sees plain text).
  const plain = value.replace(/`([^`]*)`/g, "$1");
  return plain.toLowerCase().replace(SLUG_STRIP_RE, "").replace(/ /g, "-");
}

function makePageSlugger() {
  const occurrences = new Map();
  return function slug(value) {
    const base = slugify(value);
    const n = occurrences.get(base);
    if (n === undefined) {
      occurrences.set(base, 0);
      return base;
    }
    occurrences.set(base, n + 1);
    return `${base}-${n + 1}`;
  };
}

// --- Heading-chunk splitter. Splits a page body at every H2 (`## `) and H3
// (`### `) line that is not inside a fenced code block. Each chunk's content
// runs from its heading line up to (not including) the next H2/H3 — matching
// what the captured Mintlify search samples show (the chunk keeps the
// heading markdown line itself, and nested sub-headings get their own
// separate chunk rather than being duplicated into the parent's content).
function splitIntoChunks(body, pageTitle) {
  const lines = body.split("\n");
  const headings = []; // { level, text, lineIndex }
  let fence = null; // { marker: "`"|"~", len }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      const len = fenceMatch[1].length;
      if (!fence) {
        fence = { marker, len };
      } else if (marker === fence.marker && len >= fence.len) {
        fence = null;
      }
      continue;
    }
    if (fence) continue;
    const h = line.match(/^(#{2,3}) +(\S.*)$/);
    if (h) headings.push({ level: h[1].length, text: h[2].trimEnd(), lineIndex: i });
  }

  const slug = makePageSlugger();
  const chunks = [];

  const introEnd = headings.length ? headings[0].lineIndex : lines.length;
  const introContent = lines.slice(0, introEnd).join("\n").trim();
  if (introContent) {
    chunks.push({ title: pageTitle, anchor: "", content: introContent });
  }

  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].lineIndex;
    const end = i + 1 < headings.length ? headings[i + 1].lineIndex : lines.length;
    const content = lines.slice(start, end).join("\n").trim();
    chunks.push({ title: headings[i].text, anchor: slug(headings[i].text), content });
  }

  return chunks;
}

// --- Minimal docs.json nav walk: tabs -> groups -> pages (strings only; the
// aggregated docs.json has no nested groups today).
function flattenNav(docsJson) {
  const tabs = docsJson.navigation?.tabs ?? [];
  const order = []; // { tab, group, page }
  for (const tab of tabs) {
    for (const group of tab.groups ?? []) {
      for (const page of group.pages ?? []) {
        if (typeof page === "string") order.push({ tab: tab.tab, group: group.group, page });
        // (Nested group objects are out of scope — none exist in the corpus today.)
      }
    }
  }
  return order;
}

// --- Site redirects (Mintlify's long-form page path -> Starlight's short
// slug, plus docs.json's own `redirects` array). This mirrors
// site/scripts/sync-content.mjs's toStarlightSlug()/toHref() exactly (that
// script is what actually writes site/dist/_redirects — see worker/README.md
// for why this is reimplemented here instead of read from that file) so the
// Worker can 301 the long form the same way Starlight's sibling build does.
function toStarlightSlug(mintlifySlug) {
  if (mintlifySlug === "index") return "";
  if (mintlifySlug.endsWith("/index")) return mintlifySlug.slice(0, -"/index".length);
  return mintlifySlug;
}

function toHref(starlightSlug) {
  return starlightSlug === "" ? "/" : `/${starlightSlug}`;
}

function buildRedirects(docsJson, nav) {
  const redirects = new Map(); // from -> to (docs.json entries win over auto /index ones, same order as sync-content.mjs)
  for (const entry of nav) {
    const slug = toStarlightSlug(entry.page);
    const href = toHref(slug);
    const from = `/${entry.page}`;
    if (from !== href) redirects.set(from, href);
  }
  for (const redirect of docsJson.redirects ?? []) {
    redirects.set(redirect.source, redirect.destination);
  }
  return Object.fromEntries(redirects);
}

function buildPage(sourceDir, pagePath) {
  const file = join(sourceDir, `${pagePath}.mdx`);
  const raw = readFileSync(file, "utf8");
  const { data, content } = matter(raw);
  const title = data.title ?? pagePath;
  const description = data.description ?? "";
  const sidebarTitle = data.sidebarTitle;
  const body = content.replace(/^\n+/, "").replace(/\s+$/, "");
  const chunks = splitIntoChunks(body, title);
  return { title, description, sidebarTitle, body, chunks };
}

function fsBody(page) {
  return `# ${page.title}\n\n> ${page.description}\n\n${page.body}`;
}

function buildLlmsTxt(nav, pages, siteName, siteDescription) {
  const lines = [`# ${siteName}`, "", `> ${siteDescription}`, ""];
  let currentTab = null;
  let currentGroup = null;
  for (const entry of nav) {
    const page = pages[entry.page];
    if (!page) continue;
    if (entry.tab !== currentTab) {
      currentTab = entry.tab;
      currentGroup = null;
      lines.push(`## ${currentTab}`, "");
    }
    if (entry.group !== currentGroup) {
      currentGroup = entry.group;
      lines.push(`### ${currentGroup}`, "");
    }
    const desc = page.description ? `: ${page.description}` : "";
    lines.push(`- [${page.title}]({{BASE_URL}}/${entry.page})${desc}`);
  }
  lines.push("");
  return lines.join("\n");
}

function buildLlmsFullTxt(nav, pages) {
  const parts = [];
  for (const entry of nav) {
    const page = pages[entry.page];
    if (!page) continue;
    parts.push(`<!-- {{BASE_URL}}/${entry.page} -->\n\n${fsBody(page)}`);
  }
  return parts.join("\n\n---\n\n") + "\n";
}

function main() {
  const { source, out, baseUrl } = parseArgs(process.argv.slice(2));

  const docsJson = JSON.parse(readFileSync(join(source, "docs.json"), "utf8"));
  const nav = flattenNav(docsJson);

  const pages = {};
  for (const entry of nav) {
    try {
      pages[entry.page] = buildPage(source, entry.page);
    } catch (err) {
      console.error(`  Skipping ${entry.page}: ${err.message}`);
    }
  }

  const siteName = docsJson.name ?? "VIVLA Docs";
  const siteDescription = pages["index"]?.description ?? siteName;

  const llmsTxtTemplate = buildLlmsTxt(nav, pages, siteName, siteDescription);
  const llmsFullTxtTemplate = buildLlmsFullTxt(nav, pages);
  const redirects = buildRedirects(docsJson, nav);

  const corpus = {
    generatedAt: new Date().toISOString(),
    siteName,
    siteDescription,
    nav,
    pages,
    redirects,
    llmsTxtTemplate,
    llmsFullTxtTemplate,
  };

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "corpus.json"), JSON.stringify(corpus), "utf8");

  writeFileSync(join(out, "llms.txt"), llmsTxtTemplate.replaceAll("{{BASE_URL}}", baseUrl), "utf8");
  writeFileSync(join(out, "llms-full.txt"), llmsFullTxtTemplate.replaceAll("{{BASE_URL}}", baseUrl), "utf8");

  const pagesDir = join(out, "pages");
  mkdirSync(pagesDir, { recursive: true });
  for (const [path, page] of Object.entries(pages)) {
    const dest = join(pagesDir, `${path}.md`);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, fsBody(page), "utf8");
  }

  const chunkCount = Object.values(pages).reduce((n, p) => n + p.chunks.length, 0);
  console.log(
    `Built corpus: ${Object.keys(pages).length} pages, ${chunkCount} chunks, ${Object.keys(redirects).length} redirects -> ${out}`,
  );
  if (!existsSync(join(source, "docs.json"))) {
    console.error("  Warning: docs.json not found at source — did you pass --source?");
  }
}

main();
