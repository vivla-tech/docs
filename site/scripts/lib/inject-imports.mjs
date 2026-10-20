// Makes the Mintlify compatibility components available in every copied
// page, the same way Mintlify's own MDX dialect needs no `import` line for
// `<Note>`, `<Card>`, etc.
//
// Starlight renders every content-collection page as `<Content />` with no
// `components` prop (see its routes/common.astro), so an unimported
// capitalized tag like `<Note>` always fails at render time — MDX falls
// back to looking it up on a `components` prop that's never supplied. A
// Vite-transform-based auto-import integration (astro-auto-import) was
// tried first, but its hook never ran for content-layer-loaded MDX entries
// (`docsLoader()`); the compiled output still expected `props.components`.
// So this instead prepends real `import` statements — directly readable
// MDX, not a runtime workaround — right after the frontmatter of every
// copied page. Importing a component a given page doesn't use is harmless
// (MDX/esbuild don't error on unused imports); it keeps this simple and
// avoids parsing each page just to decide what it needs.

import path from 'node:path';

// name -> path relative to site/src/components/mintlify/, or a bare package
// specifier for named exports.
const MINTLIFY_COMPONENTS = [
  'Note',
  'Warning',
  'Tip',
  'Info',
  'Check',
  'Danger',
  'Card',
  'CardGroup',
  'Columns',
  'Tabs',
  'Tab',
  'Steps',
  'Step',
  'Accordion',
  'AccordionGroup',
  'CodeGroup',
  'Frame',
];

/**
 * @param {string} mdxText output of sanitizeMdx + transformCodeGroups
 * @param {string} destPath absolute path the file will be written to
 * @param {string} componentsDir absolute path to src/components/mintlify
 * @returns {string}
 */
export function injectImports(mdxText, destPath, componentsDir) {
  const fromDir = path.dirname(destPath);
  const relToComponents = toPosix(path.relative(fromDir, componentsDir));

  const lines = [
    ...MINTLIFY_COMPONENTS.map(
      (name) => `import ${name} from '${relToComponents}/${name}.astro';`
    ),
    // The <CodeGroup> -> <Tabs>/<TabItem> rewrite (scripts/lib/codegroup.mjs)
    // emits Starlight's own TabItem directly.
    `import { TabItem } from '@astrojs/starlight/components';`,
  ];

  const fmEnd = mdxText.indexOf('\n---\n');
  if (mdxText.startsWith('---\n') && fmEnd !== -1) {
    const splitAt = fmEnd + '\n---\n'.length;
    return mdxText.slice(0, splitAt) + '\n' + lines.join('\n') + '\n' + mdxText.slice(splitAt);
  }
  // No frontmatter (shouldn't happen in this corpus) — prepend at the top.
  return lines.join('\n') + '\n\n' + mdxText;
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}
