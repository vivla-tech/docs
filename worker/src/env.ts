export interface Env {
  ASSETS: Fetcher;
  FEEDBACK: D1Database;
  /** Cloudflare Access team domain, e.g. "https://vivla.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN: string;
  /** Comma-separated list of accepted Access application AUD tags (prod + staging). */
  ACCESS_AUD: string;
  /** Canonical site origin used to build absolute links in tool output, e.g. "https://wiki.vivla.com". */
  SITE_BASE_URL: string;
}
