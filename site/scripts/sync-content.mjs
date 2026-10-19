#!/usr/bin/env node
// Builds site/src/content/docs/, site/src/data/nav.json, site/public/* and
// site/src/assets/logo-*.svg from the aggregated docs tree (docs.json +
// *.mdx + fonts/ + logo/ + favicon.svg + images/), exactly as Mintlify
// reads it. Runs before every `astro dev`/`astro build` (see package.json).
//
// By default the content root is one directory above site/ (this repo's own
// root), which is enough for local iteration against the central pages.
// Point VIVLA_DOCS_CONTENT_ROOT at a checkout of the aggregated `docs`
// branch to build the full 121-page site — see site/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { sanitizeMdx } from './lib/sanitize-mdx.mjs';
import { transformCodeGroups } from './lib/codegroup.mjs';

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_ROOT = process.env.VIVLA_DOCS_CONTENT_ROOT
  ? path.resolve(process.env.VIVLA_DOCS_CONTENT_ROOT)
  : path.resolve(SITE_ROOT, '..');

const CONTENT_OUT = path.join(SITE_ROOT, 'src/content/docs');
const DATA_OUT = path.join(SITE_ROOT, 'src/data');
const ASSETS_OUT = path.join(SITE_ROOT, 'src/assets');
const PUBLIC_OUT = path.join(SITE_ROOT, 'public');

/** Mintlify page path -> Starlight slug: "tools/chat/index" -> "tools/chat",
 *  "index" -> "" (homepage). Matches how the docsLoader derives slugs from
 *  file paths under src/content/docs/. */
function toStarlightSlug(mintlifySlug) {
  if (mintlifySlug === 'index') return '';
  if (mintlifySlug.endsWith('/index')) return mintlifySlug.slice(0, -'/index'.length);
  return mintlifySlug;
}

function toHref(starlightSlug) {
  return starlightSlug === '' ? '/' : `/${starlightSlug}`;
}

function rimraf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function main() {
  const docsJsonPath = path.join(CONTENT_ROOT, 'docs.json');
  if (!fs.existsSync(docsJsonPath)) {
    console.error(`[sync-content] docs.json not found at ${docsJsonPath}.`);
    console.error(
      '[sync-content] Set VIVLA_DOCS_CONTENT_ROOT to a checkout of the aggregated "docs" branch.'
    );
    process.exit(1);
  }
  const docsJson = JSON.parse(fs.readFileSync(docsJsonPath, 'utf8'));

  rimraf(CONTENT_OUT);
  fs.mkdirSync(CONTENT_OUT, { recursive: true });
  fs.mkdirSync(DATA_OUT, { recursive: true });
  fs.mkdirSync(ASSETS_OUT, { recursive: true });
  fs.mkdirSync(PUBLIC_OUT, { recursive: true });

  const pageMeta = new Map(); // mintlifySlug -> { title, description, sidebarTitle }
  const copiedSlugs = new Set();
  let totalEscapes = 0;
  let totalCodeGroups = 0;
  let missingPages = 0;

  function copyPage(mintlifySlug) {
    if (copiedSlugs.has(mintlifySlug)) return;
    const srcPath = path.join(CONTENT_ROOT, `${mintlifySlug}.mdx`);
    if (!fs.existsSync(srcPath)) {
      console.warn(`[sync-content] missing page referenced in docs.json: ${mintlifySlug}.mdx`);
      missingPages++;
      return;
    }
    copiedSlugs.add(mintlifySlug);

    const raw = fs.readFileSync(srcPath, 'utf8');
    const parsed = matter(raw);
    pageMeta.set(mintlifySlug, {
      title: parsed.data.title ?? mintlifySlug,
      description: parsed.data.description ?? '',
      sidebarTitle: parsed.data.sidebarTitle ?? null,
    });

    const sanitized = sanitizeMdx(raw);
    const transformed = transformCodeGroups(sanitized.output);
    totalEscapes += sanitized.escapes;
    totalCodeGroups += transformed.groups;

    const destPath = path.join(CONTENT_OUT, `${mintlifySlug}.mdx`);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, transformed.output);
  }

  const tabs = [];
  const redirects = new Map(); // from -> to (docs.json entries win over auto /index ones)

  for (const tab of docsJson.navigation?.tabs ?? []) {
    const groups = [];
    let landingSlug = null;
    for (const group of tab.groups ?? []) {
      const pages = [];
      for (const pageSlug of group.pages ?? []) {
        if (typeof pageSlug !== 'string') {
          console.warn(
            `[sync-content] skipping non-string page entry in tab "${tab.tab}" / group "${group.group}" (nested groups aren't used in this corpus)`
          );
          continue;
        }
        copyPage(pageSlug);
        const meta = pageMeta.get(pageSlug);
        if (!meta) continue;

        const slug = toStarlightSlug(pageSlug);
        const href = toHref(slug);
        if (landingSlug === null) landingSlug = slug;
        pages.push({ slug, href, label: meta.sidebarTitle || meta.title });

        // Mintlify serves both "/tools/index" and "/tools"; Starlight only
        // generates the short form, so keep the long one working too.
        if (pageSlug !== slug) {
          const from = `/${pageSlug}`;
          if (from !== href) redirects.set(from, href);
        }
      }
      if (pages.length > 0) groups.push({ label: group.group, pages });
    }
    tabs.push({ label: tab.tab, href: toHref(landingSlug ?? ''), groups });
  }

  for (const redirect of docsJson.redirects ?? []) {
    redirects.set(redirect.source, redirect.destination);
  }

  // Static assets Mintlify serves from the repo root.
  for (const asset of ['fonts', 'images']) {
    const src = path.join(CONTENT_ROOT, asset);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(PUBLIC_OUT, asset), { recursive: true });
  }
  const favicon = path.join(CONTENT_ROOT, 'favicon.svg');
  if (fs.existsSync(favicon)) fs.copyFileSync(favicon, path.join(PUBLIC_OUT, 'favicon.svg'));

  // Logo goes through Astro's asset pipeline (Starlight's `logo` option
  // resolves light/dark as imports, not public URLs), so it's copied into
  // src/assets/ rather than public/.
  for (const variant of ['light', 'dark']) {
    const src = path.join(CONTENT_ROOT, 'logo', `${variant}.svg`);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(ASSETS_OUT, `logo-${variant}.svg`));
  }

  const redirectLines = [...redirects.entries()].map(([from, to]) => `${from}  ${to}  301`);
  fs.writeFileSync(path.join(PUBLIC_OUT, '_redirects'), `${redirectLines.join('\n')}\n`);

  fs.writeFileSync(path.join(DATA_OUT, 'nav.json'), JSON.stringify({ tabs }, null, 2));

  console.log(`[sync-content] content root: ${CONTENT_ROOT}`);
  console.log(`[sync-content] copied ${copiedSlugs.size} pages`);
  if (missingPages > 0) console.warn(`[sync-content] ${missingPages} page(s) referenced but missing`);
  console.log(`[sync-content] sanitized ${totalEscapes} bare "<"/"{" occurrence(s)`);
  console.log(`[sync-content] rewrote ${totalCodeGroups} <CodeGroup> block(s) into <Tabs>`);
  console.log(`[sync-content] wrote ${redirectLines.length} redirect(s) to public/_redirects`);
}

main();
