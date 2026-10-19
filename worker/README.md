# vivla-wiki Worker

Serves the self-hosted VIVLA Docs site (Workers Static Assets) and `/mcp`
behind Cloudflare Access, from one Worker. See
`_projects/wiki-self-hosted/PLAN.md` for the full design and
`_projects/wiki-self-hosted/parity/mcp-parity.md` for the MCP parity result
against the live Mintlify deployment.

Run all installs, builds and tests on a machine with network access and
enough headroom (not a laptop you're also using) — these commands assume
that.

## Layout

- `src/index.ts` — entry point: Access JWT check, `/mcp` routing, static
  asset fallback.
- `src/access.ts` — verifies `Cf-Access-Jwt-Assertion` (jose, remote JWKS).
- `src/mcp.ts` — the three tools + the `vivla` skill resource, built from
  `src/mcp-tool-defs.json` (a straight copy of Mintlify's captured
  `tools-list.json` — do not hand-edit descriptions/schemas there without
  re-checking parity).
- `src/search.ts` — `search_vivla_docs` (Orama, Spanish BM25).
- `src/filesystem.ts` — `query_docs_filesystem_vivla_docs` (just-bash).
- `src/feedback.ts` — `submit_feedback` (D1).
- `src/pages.ts` — fallback rendering of `/<page>.md`, `/llms.txt`,
  `/llms-full.txt` from the corpus when the static site doesn't have its
  own copy (yet, or at all).
- `src/redirects.ts` — 301s for the long Mintlify page path (`/tools/index`)
  to its short Starlight slug (`/tools`), plus `docs.json`'s own
  `redirects`. Workers Static Assets' own `_redirects` handling does not
  apply here — see that file's comment — so this reimplements the exact
  rule `site/scripts/sync-content.mjs` uses to write `site/dist/_redirects`
  (confirmed against that script's source on `feat/starlight-site`), computed
  independently in `scripts/build-corpus.mjs` from `docs.json` rather than by
  reading that file. **Risk:** if that script's redirect rule ever changes,
  this one needs updating too — there's no single source of truth. A
  follow-up could have the Worker's build step read the real
  `site/dist/_redirects` once the CI job order guarantees the site builds
  first (see plan `PLAN.md` §4 step (b) before (c)); until then this is
  validated against it by the URL crawl in the parity report.
- `src/content.ts` — loads `generated/corpus.json` as a bundled JSON
  module.
- `migrations/` — D1 schema for `wiki_feedback`.
- `public-placeholder/` — a two-file placeholder site for local dev/tests.
  **Not the real site.** Once `site/` (built on `feat/starlight-site`)
  merges, point `assets.directory` in `wrangler.jsonc` at `../site/dist`
  and delete this folder.

## Building the corpus

The Worker bundles `worker/generated/corpus.json` at build time — it's a
build artifact (gitignored), not checked in. Build it from a checkout of the
aggregated `docs` branch (where the subrepo content actually lives):

```bash
# materialize the docs branch content anywhere, e.g.:
git -C <repo> archive origin/docs | tar -x -C /tmp/docs-branch

node scripts/build-corpus.mjs --source /tmp/docs-branch --out worker/generated
```

Run this before `wrangler dev`, before `npm test`, and before `wrangler
deploy`. (The CI job that does this automatically is W-5, not part of this
change — see the PLAN's task breakdown.)

## Local dev

```bash
cd worker
pnpm install
pnpm run typecheck
pnpm test
pnpm run dev   # wrangler dev
```

Use `pnpm`, not `npm` — `npm install` hits a real npm 10 bug
(`TypeError: Cannot read properties of null (reading 'edgesOut')` in
arborist) on this exact dependency graph; `pnpm` installs cleanly.
`pnpm test` needs `generated/corpus.json` to exist first (see above) — the
unit tests exercise the real corpus content, not a synthetic fixture.

### Testing against the real site

`public-placeholder/` is enough for the unit tests, but to check the full
request pipeline (redirects, asset serving, the Access JWT check) against
the real Starlight build:

```bash
# 1. Build the site (feat/starlight-site; see its own site/README.md):
cd site && pnpm install && VIVLA_DOCS_CONTENT_ROOT=/path/to/docs-branch-checkout pnpm run build

# 2. Point this Worker's wrangler.jsonc assets.directory at that site/dist,
#    and ACCESS_TEAM_DOMAIN at a local JWKS server serving a key you mint a
#    matching Cf-Access-Jwt-Assertion token with (jose's generateKeyPair +
#    SignJWT) — wrangler dev doesn't go through real Cloudflare Access, so
#    there's no other way to pass the JWT check locally.
# 3. `wrangler dev` and curl all canonical URLs + redirect sources.
```

Done this way against the real `site/dist` (PR #11, `feat/starlight-site`,
built with `VIVLA_DOCS_CONTENT_ROOT` pointed at the aggregated `docs`
branch): all 121 canonical URLs return 200, all 25 `_redirects` entries
301 to the right target (confirming `src/redirects.ts` matches
`site/dist/_redirects` byte for byte — see that file's comment), an
anonymous request 403s, and `/mcp` answers `initialize` correctly through
the full pipeline. See the PR description for the exact numbers.

## Configuration (`wrangler.jsonc`)

- `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`: Cloudflare Access team domain and the
  comma-separated list of accepted Access application AUD tags. Today this
  is just the "VIVLA Docs" app's AUD. When `wiki-next.vivla.com` gets its
  own Access destination/app (plan phase 3), append its AUD to the
  comma-separated `ACCESS_AUD` var — no code change.
- `SITE_BASE_URL`: used to build absolute links in `search_vivla_docs` and
  to render `llms.txt`/`llms-full.txt`. Differs per environment (prod vs.
  `env.staging`).
- `d1_databases[].database_id`: placeholder — see the deploy runbook in the
  PR description for creating the real D1 database.

## What's deliberately out of scope here

- `site/` (the Astro Starlight build) — a different branch,
  `feat/starlight-site`. `assets.directory` points at a placeholder until
  the branches merge.
- Actually deploying anything, creating the D1 database, or touching the
  Access app — this PR only prepares the Worker and its config. See the PR
  description for the deploy runbook.
