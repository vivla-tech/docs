# VIVLA Docs (wiki.vivla.com)

The central wiki for VIVLA: engineering, product and CX. It is private, behind Cloudflare Access (login with Vivla Identity, `@vivla.com` accounts only).

## How it works

| Part | Where | What it does |
|---|---|---|
| Content | `*.mdx` + `docs.json` (this repo) and `docs/wiki/` in each subrepo | The pages. Mintlify-dialect MDX; `docs.json` sets tabs, groups, page order and redirects. |
| Aggregation | `.github/workflows/aggregate.yml`, job `aggregate` | Copies the subrepo pages into the `docs` branch and merges their `docs.json` tabs. |
| Site | `site/` | An [Astro Starlight](https://starlight.astro.build) build of the `docs` branch, with a compatibility layer for the Mintlify components. |
| Worker | `worker/` | The Cloudflare Worker `vivla-wiki`. It serves the site, checks the Access JWT and runs the MCP at `/mcp`. |
| Deploy | `aggregate.yml`, job `deploy-wiki` | Builds the site, the MCP corpus and the search embeddings, runs the tests, then deploys staging and production. |

## Write a page

1. Add or edit an `.mdx` file with `title` and `description` in the frontmatter.
2. Add the page to `docs.json` (pages in a subrepo go in that subrepo's `docs/wiki/docs.json`).
3. Open a PR to `main`. The **Wiki build check** must pass before you merge.

Supported components: `Note`, `Tip`, `Info`, `Warning`, `Danger`, `Check`, `Card`, `CardGroup`, `Columns`, `Tabs`/`Tab`, `Steps`/`Step`, `Accordion`/`AccordionGroup`, `CodeGroup`, `Frame`, and Mermaid code fences. Any other component breaks the build.

Escape a literal `<` or `{` in prose (`\<`, `\{`), or put it in inline code. The build fixes the common cases, but not all of them.

## Preview locally

```bash
cd site
pnpm install
VIVLA_DOCS_CONTENT_ROOT=.. pnpm run dev
```

To see the subrepo tabs too, point `VIVLA_DOCS_CONTENT_ROOT` at a checkout of the `docs` branch. `scripts/build-wiki.sh <content-root>` runs the full build that CI runs.

## Environments

- Production: `https://wiki.vivla.com`. Worker `vivla-wiki`, route `wiki.vivla.com/*`.
- Staging: `https://wiki-next.vivla.com`. Worker `vivla-wiki-staging`. CI deploys it first and smoke-tests it.

Both sit behind the Access app **VIVLA Docs**. The Workers have no `workers.dev` or preview URL.

## Rollback

Until Mintlify is decommissioned, the `wiki` DNS record still points at Mintlify. To roll back, remove the `routes` entry from `worker/wrangler.jsonc` and deploy (or delete the route in the Cloudflare dashboard: Workers → vivla-wiki → Settings → Domains & Routes).
