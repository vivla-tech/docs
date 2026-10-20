// Applies the site's redirects (long Mintlify path -> short Starlight slug,
// plus docs.json's own `redirects` array) ourselves. Workers Static Assets
// does NOT apply a static-asset-directory `_redirects` file to requests
// that reach it through `env.ASSETS.fetch()` called from Worker code —
// per Cloudflare's own docs: "Redirects defined in the _redirects file are
// not applied to requests served by your Worker code" — and
// `run_worker_first: true` means every request is exactly that. See
// worker/README.md for why this is computed independently (in
// scripts/build-corpus.mjs) rather than read from site/dist/_redirects.
import { corpus } from "./content";

/** Returns the absolute redirect target for `pathname`, or null if none applies. */
export function resolveRedirect(pathname: string): string | null {
  return corpus.redirects[pathname] ?? null;
}
