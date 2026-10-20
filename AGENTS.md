# Documentation project instructions

## About this project

- This is the central documentation site for VIVLA. It is built with [Astro Starlight](https://starlight.astro.build) (`site/`) and served by the Cloudflare Worker `vivla-wiki` (`worker/`), which also runs the MCP at `/mcp`
- Pages are MDX files with YAML frontmatter, in the Mintlify MDX dialect (the site has a compatibility layer)
- Configuration lives in `docs.json`: tabs, groups, page order and redirects
- Preview locally: `cd site && pnpm install && VIVLA_DOCS_CONTENT_ROOT=.. pnpm run dev`
- Hosted at `wiki.vivla.com` behind Cloudflare Access; staging at `wiki-next.vivla.com`
- Every PR to `main` must pass the **Wiki build check**. The `deploy-wiki` job in `aggregate.yml` deploys on every aggregate run

## Supported components

Use only these: `Note`, `Tip`, `Info`, `Warning`, `Danger`, `Check`, `Card`, `CardGroup`, `Columns`, `Tabs`/`Tab`, `Steps`/`Step`, `Accordion`/`AccordionGroup`, `CodeGroup`, `Frame`, and Mermaid code fences. Any other component breaks the build.

Escape a literal `<` or `{` in prose (`\<`, `\{`), or put it in inline code.

## Architecture

- **Central repo** (`docs`): Global `docs.json`, shared pages (overview, architecture, infra)
- **Manifest** (`repos.yml`): one entry per documented repo. `mode: subrepo` repos keep their own `docs/wiki`; `mode: documenter` repos are written into this repo by the vivla-smurfs documenter (under `sistemas/<repo>/`, or `backend/` + `operativa/` for vivla-api)
- **Aggregation**: GitHub Action (`aggregate.yml`) copies the subrepos listed in `repos.yml` into the `docs` branch, then the `deploy-wiki` job builds and deploys the site and the MCP
- Do not edit pages under a documenter section by hand without a reason: the next documenter run reconciles them with the code

## Terminology

- Use "propiedad" not "listing" in Spanish docs
- Use "reserva" not "booking" in Spanish docs
- Use "usuario" not "user" in Spanish docs

## Style preferences

- Write in Spanish for all documentation pages
- Use active voice and second person ("vos" / "tu" informal)
- Keep sentences concise — one idea per sentence
- Use sentence case for headings
- Bold for UI elements: Click **Settings**
- Code formatting for file names, commands, paths, and code references

## Content boundaries

- Never include business logic details, pricing, or revenue models
- Never include credentials, API keys, or secrets
- Never reference internal Slack channels or private URLs
- The repos are private — do not document how to make them public
