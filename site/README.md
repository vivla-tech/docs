# site/ — the Starlight engine for wiki.vivla.com

This replaces Mintlify with a static [Astro Starlight](https://starlight.astro.build) site that
reads the same content (Mintlify-dialect MDX + `docs.json`) and renders it to look and behave the
same. See `_projects/wiki-self-hosted/PLAN.md` at the repo root for the full design and the
`worker/` directory (separate branch, not in this one) for the Cloudflare Worker that serves this
build and the MCP.

Nothing here is wired up for Mintlify to build — `site/` and `worker/` are both listed in the root
`.mintignore`.

## Output contract

`npm run build` writes a static site to **`site/dist/`**. That is the directory the Worker serves
via Workers Static Assets (`assets.directory` in `worker/wrangler.jsonc`). It contains:

- Directory-style HTML (`tools/chat/index.html` for `/tools/chat`), Pagefind's search index,
  and Expressive Code's syntax highlighting assets.
- `_redirects` — Netlify-style redirect rules the Worker's static asset handler reads directly.
  Keeps every URL Mintlify serves today working: `docs.json`'s own `redirects` array, plus one
  `/<dir>/index -> /<dir>` rule per index page (Mintlify serves both forms; Starlight's slug for
  `tools/chat/index.mdx` is `tools/chat`, dropping `/index`).

**Coordination point for the Worker:** set `assets.html_handling: "drop-trailing-slash"` in
`wrangler.jsonc` so both `/tools` and `/tools/` resolve to the same page — this build uses
`trailingSlash: 'never'` throughout (matches Mintlify, which never adds a trailing slash either).

## How content gets in

Content is **not** copied by hand and never edited by this engine. `npm run build` and
`npm run dev` both run `scripts/sync-content.mjs` first (see `package.json`), which:

1. Reads `docs.json` and every `*.mdx` page it references from a **content root** — by default
   the directory one level above `site/` (this repo's own root), overridable with
   `VIVLA_DOCS_CONTENT_ROOT`.
2. Applies a small, reversible MDX-safety pass (`scripts/lib/sanitize-mdx.mjs`): backslash-escapes
   the handful of bare `<`/`{` characters in prose that Mintlify's parser tolerates but Astro's
   stricter MDX compiler doesn't (e.g. `<día>`, `{nombre}` used as literal placeholders). This
   never touches fenced code, inline code, or JSX attribute expressions like `cols={2}` — the
   rendered page is byte-identical. See the comment at the top of that file.
3. Rewrites `<CodeGroup>` blocks into `<Tabs>`/`<TabItem>` (`scripts/lib/codegroup.mjs`) — Mintlify
   renders CodeGroup's sibling code fences as tabs, and that rewrite has to happen as text before
   MDX compiles it (a component can't see a child fence's info string after compilation).
4. Copies the result into `src/content/docs/`, copies `fonts/`, `images/`, `favicon.svg` from the
   content root into `public/`, and the two `logo/*.svg` files into `src/assets/` (Starlight's
   `logo` option resolves those as asset imports, not public URLs).
5. Writes `src/data/nav.json`: one entry per `docs.json` tab, each with its groups and pages in the
   exact order authored. `src/lib/nav.ts` reads this to build the per-tab sidebar
   (`src/routeData.ts`, a Starlight route middleware — native Starlight has one global sidebar, not
   one per tab) and the horizontal tab bar (`src/components/SiteHeader.astro`, a `Header` override).

None of `src/content/docs/`, `src/data/nav.json`, `src/assets/logo-*.svg`, or `public/` is
committed — they're build output (see `.gitignore`).

**To build the full 121-page site**, point `VIVLA_DOCS_CONTENT_ROOT` at a checkout of the
aggregated `docs` branch (what Mintlify deploys today — see `.github/workflows/aggregate.yml`).
This worktree's own branch only carries the central repo's content plus per-subrepo stub pages
(`tools/index.mdx` etc.), same as `main`.

```bash
# One-time: get a checkout of the aggregated content next to this one.
git clone git@github.com-work:vivla-tech/docs.git /path/to/docs-aggregated
git -C /path/to/docs-aggregated checkout docs

cd site
pnpm install
VIVLA_DOCS_CONTENT_ROOT=/path/to/docs-aggregated pnpm run build
pnpm exec astro preview   # serve dist/ locally to eyeball it
```

Once this engine is merged to `main`, `aggregate.yml`'s `git checkout -B docs` step carries `site/`
and `worker/` into the `docs` branch tree along with the aggregated content (it reuses the full
working tree, not just the content paths) — so a future `build-and-deploy` CI job can just check
out `docs` and run `cd site && pnpm install && pnpm run build` with no extra wiring. That job isn't
added yet (task W-5 in the plan); for now the full build is run by hand as above.

**Do not** run `pnpm install` / `astro build` / `astro dev` on a laptop for this project — it's
built and previewed on the VPS.

## Component mapping (Mintlify -> Starlight)

All wrappers live in `src/components/mintlify/` and are auto-imported into every MDX file by
`astro-auto-import` (see `astro.config.mjs`) — no `import` line needed in content, matching
Mintlify's own zero-import authoring.

| Mintlify | File | Notes |
|---|---|---|
| `<Note>` | `Note.astro` | `Aside type="note"` |
| `<Tip>` | `Tip.astro` | `Aside type="tip"` |
| `<Warning>` | `Warning.astro` | `Aside type="caution"` |
| `<Info>` | `Info.astro` | `Aside type="note"`; not used in content today, wired defensively |
| `<Danger>` | `Danger.astro` | `Aside type="danger"`; not used today |
| `<Check>` | `Check.astro` | Custom (Starlight's Aside has no "success" variant); not used today |
| `<Card title icon href>` | `Card.astro` | Custom: `href` makes the whole card a link; `icon` resolved via `src/lib/icon-map.ts` |
| `<CardGroup cols>` | `CardGroup.astro` | Custom CSS grid (Starlight's `CardGrid` has no `cols` prop) |
| `<Columns cols>` | `Columns.astro` | Same grid, no card chrome |
| `<Tabs>` / `<Tab title>` | `Tabs.astro` / `Tab.astro` | Thin wrappers over Starlight's `Tabs`/`TabItem` |
| `<Steps>` / `<Step title>` | `Steps.astro` / `Step.astro` | Custom (Starlight's `Steps` needs a plain `<ol>` child, not `<Step>` components) |
| `<Accordion title>` / `<AccordionGroup>` | `Accordion.astro` / `AccordionGroup.astro` | `<details>`/`<summary>`, styled |
| `<CodeGroup>` | rewritten to `<Tabs>`/`<TabItem>` at build time | `CodeGroup.astro` is only a fallback for the one block in the corpus the rewrite can't parse (a malformed single-line fence) |
| `<Frame caption>` | `Frame.astro` | Not used in content today, wired defensively |
| ` ```mermaid ` | `astro-mermaid` | Client-side rendering, theme follows light/dark |
| Other code fences | Expressive Code (built into Starlight) | |

Icon names: the Card icon inventory (80 distinct Font Awesome names) was checked against the
`fa6-solid` and `fa6-brands` Iconify sets. Three names (`package`, `rectangle-vertical-history`,
`shield-check`) aren't in either free set — Mintlify's own icon picker draws from a larger (partly
Pro) catalog — and fall back to the closest free equivalent; see the comment in
`src/lib/icon-map.ts`.

Any other JSX tag in content (not in the table above and not plain HTML) fails the Astro build —
intentional, see `scripts/lib/sanitize-mdx.mjs`'s `KNOWN_TAGS` list, which both the sanitizer and
the auto-import config draw from.

## Navigation, theme, redirects

- **Tabs/sidebar/page order**: generated from `docs.json` at build time (`src/lib/nav.ts`,
  `src/routeData.ts`, `src/components/SiteHeader.astro`), not hand-coded — stays in sync with
  content automatically.
- **Theme**: `src/styles/theme.css` sets Vivla's colors (`#0c2425` primary / `#cf7625` accent, same
  split Mintlify uses between light and dark mode) and the Teodor/Sneak fonts from the aggregated
  `fonts/` directory.
- **Search**: Pagefind (built into Starlight), `lang: es` via `locales.root.lang`.
- **Links**: `starlight-links-validator` runs in warn mode (`failOnError: false`) — some links in
  the content are already broken today (see PLAN.md §3.1); this reports them without failing CI.

## Local testing without installing anything

`scripts/lib/sanitize-mdx.mjs` and `scripts/lib/codegroup.mjs` have no dependencies and can be
exercised with plain `node` against any MDX file, without `pnpm install` — useful for checking a
specific page before a full VPS build round-trip.
