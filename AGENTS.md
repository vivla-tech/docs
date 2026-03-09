# Documentation project instructions

## About this project

- This is the central documentation site for VIVLA, built on [Mintlify](https://mintlify.com)
- Pages are MDX files with YAML frontmatter
- Configuration lives in `docs.json`
- Run `mintlify dev` to preview locally
- Hosted at `wiki.vivla.com` behind Cloudflare Access

## Architecture

- **Central repo** (`docs`): Global `docs.json`, shared pages (overview, architecture, infra)
- **Subrepos** (`vivla-backend`, `vivla-mobile`): Each has a `/docs` folder with its own pages
- **Aggregation**: GitHub Action (`aggregate.yml`) merges subrepo docs into this repo on push to main

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
