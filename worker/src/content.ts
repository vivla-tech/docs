// Loads the build-time corpus (scripts/build-corpus.mjs output) as a bundled
// JSON module — no filesystem access needed at runtime, no drift between the
// site and the MCP (one corpus, one deploy).
//
// worker/generated/* does not exist in this checkout until you run the corpus
// script (see worker/README.md); that's expected — these are build artifacts,
// not committed files.
//
// The corpus is imported as size-balanced shards + a metadata file rather than
// one corpus.json: @cloudflare/vitest-plugin ships each imported module's full
// source to the workerd test runner in a single WebSocket message, and the
// whole corpus as one module blows past workerd's per-message limit ("Message
// is too large", 1009). The shards are merged back here, losslessly. Keep this
// import list at SHARD_COUNT entries (scripts/lib/shard-record.mjs).
import corpusMeta from "../generated/corpus-meta.json";
import corpusPages0 from "../generated/corpus-pages-0.json";
import corpusPages1 from "../generated/corpus-pages-1.json";
import corpusPages2 from "../generated/corpus-pages-2.json";
import corpusPages3 from "../generated/corpus-pages-3.json";
import corpusPages4 from "../generated/corpus-pages-4.json";
import corpusPages5 from "../generated/corpus-pages-5.json";
import corpusPages6 from "../generated/corpus-pages-6.json";
import corpusPages7 from "../generated/corpus-pages-7.json";

const corpusData = {
  ...corpusMeta,
  pages: {
    ...corpusPages0,
    ...corpusPages1,
    ...corpusPages2,
    ...corpusPages3,
    ...corpusPages4,
    ...corpusPages5,
    ...corpusPages6,
    ...corpusPages7,
  },
};

export interface Chunk {
  /** Heading text (or the page title, for the chunk before the first heading). */
  title: string;
  /** Slug fragment, or "" for the intro chunk (no heading to anchor to). */
  anchor: string;
  content: string;
}

export interface Page {
  title: string;
  description: string;
  sidebarTitle?: string;
  body: string;
  chunks: Chunk[];
}

export interface NavEntry {
  tab: string;
  group: string;
  page: string;
}

export interface Corpus {
  generatedAt: string;
  siteName: string;
  siteDescription: string;
  nav: NavEntry[];
  pages: Record<string, Page>;
  /** Long Mintlify page path -> short Starlight slug, plus docs.json's own redirects. Absolute paths, no query/hash. */
  redirects: Record<string, string>;
  llmsTxtTemplate: string;
  llmsFullTxtTemplate: string;
}

export const corpus = corpusData as unknown as Corpus;

// Confirmed against the live Mintlify server: when a page's body already
// opens with an H1 that exactly repeats the frontmatter title, it renders
// only one "# <title>" — not the synthetic one immediately followed by the
// body's own identical copy. Kept in sync with the same function in
// scripts/build-corpus.mjs.
function stripRedundantLeadingHeading(body: string, title: string): string {
  const titleLine = `# ${title}`;
  if (!body.startsWith(titleLine)) return body;
  return body.slice(titleLine.length).replace(/^\n+/, "");
}

/** The just-bash / `/<page>.md` rendering: `# title\n\n> description\n\n<body>`. */
export function pageFsBody(page: Page): string {
  const body = stripRedundantLeadingHeading(page.body, page.title);
  return `# ${page.title}\n\n> ${page.description}\n\n${body}`;
}

const templateCache = new Map<string, string>();

/** Renders llms.txt / llms-full.txt for a given deploy's SITE_BASE_URL, memoized per isolate. */
export function renderTemplate(key: "llmsTxtTemplate" | "llmsFullTxtTemplate", baseUrl: string): string {
  const cacheKey = `${key}:${baseUrl}`;
  const cached = templateCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const rendered = corpus[key].replaceAll("{{BASE_URL}}", baseUrl);
  templateCache.set(cacheKey, rendered);
  return rendered;
}
