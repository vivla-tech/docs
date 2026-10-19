// Loads the build-time corpus (scripts/build-corpus.mjs output) as a bundled
// JSON module — no filesystem access needed at runtime, no drift between the
// site and the MCP (one corpus, one deploy).
//
// worker/generated/corpus.json does not exist in this checkout until you run
// the corpus script (see worker/README.md); that's expected — it's a build
// artifact, not a committed file.
import corpusData from "../generated/corpus.json";

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

/** The just-bash / `/<page>.md` rendering: `# title\n\n> description\n\n<body>`. */
export function pageFsBody(page: Page): string {
  return `# ${page.title}\n\n> ${page.description}\n\n${page.body}`;
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
