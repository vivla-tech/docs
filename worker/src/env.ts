export interface Env {
  ASSETS: Fetcher;
  FEEDBACK: D1Database;
  /** Workers AI binding — embeds the query for search_vivla_docs's dense/hybrid ranking. Inference only, no resource of its own to create. */
  AI: Ai;
  /** Cloudflare Access team domain, e.g. "https://vivla.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN: string;
  /** Comma-separated list of accepted Access application AUD tags (prod + staging). */
  ACCESS_AUD: string;
  /** Canonical site origin used to build absolute links in tool output, e.g. "https://wiki.vivla.com". */
  SITE_BASE_URL: string;
}
