// Fallback rendering of /<page>.md, /llms.txt and /llms-full.txt straight
// from corpus.json. The Starlight site (site/, a separate branch) is meant
// to produce its own copies of these as static output; this only serves
// requests ASSETS can't answer — e.g. before the two branches are merged,
// or if a page's static .md file is ever missing. Once site/dist has its
// own, env.ASSETS.fetch() answers first and this code never runs for it.
import { corpus, pageFsBody, renderTemplate } from "./content";

const TEXT_HEADERS = { "content-type": "text/markdown; charset=utf-8" };

export function tryServeGeneratedPage(pathname: string, baseUrl: string): Response | null {
  if (pathname === "/llms.txt") {
    return new Response(renderTemplate("llmsTxtTemplate", baseUrl), { headers: TEXT_HEADERS });
  }
  if (pathname === "/llms-full.txt") {
    return new Response(renderTemplate("llmsFullTxtTemplate", baseUrl), { headers: TEXT_HEADERS });
  }
  if (pathname.endsWith(".md")) {
    const pagePath = pathname.slice(1, -3); // strip leading "/" and trailing ".md"
    const page = corpus.pages[pagePath];
    if (page) return new Response(pageFsBody(page), { headers: TEXT_HEADERS });
  }
  return null;
}
