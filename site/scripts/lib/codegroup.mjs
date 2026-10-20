// Mintlify's <CodeGroup> wraps a set of sibling fenced code blocks and
// renders them as tabs, with each tab's label taken from the fence info
// string (e.g. ```bash Desarrollo` -> tab "Desarrollo"). Starlight has no
// equivalent component, but its own <Tabs>/<TabItem> produce the same
// result. A runtime wrapper component cannot do this rewrite itself — by
// the time a component receives its MDX children as a slot, the fenced
// code blocks are already compiled and their fence info string is gone.
// So this rewrite happens as a source-to-source MDX transform instead,
// before the file reaches the MDX compiler. Rendered output is unchanged:
// same code, same tab labels, same order.
//
// A <CodeGroup> block that doesn't cleanly contain only fenced code blocks
// (plus blank lines) is left untouched; it falls back to the plain
// CodeGroup.astro wrapper at render time.

import { fenceDelimiter } from './sanitize-mdx.mjs';

const OPEN_RE = /^\s*<CodeGroup\s*>\s*$/;
const CLOSE_RE = /^\s*<\/CodeGroup>\s*$/;

function escapeAttr(value) {
  return value.replace(/"/g, '&quot;');
}

/**
 * @param {string} source sanitized MDX content (after sanitizeMdx)
 * @returns {{ output: string, groups: number }}
 */
export function transformCodeGroups(source) {
  const lines = source.split('\n');
  const out = [];
  let groups = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!OPEN_RE.test(line)) {
      out.push(line);
      i++;
      continue;
    }

    // Find the matching </CodeGroup>, collecting the body.
    const bodyStart = i + 1;
    let bodyEnd = -1;
    for (let j = bodyStart; j < lines.length; j++) {
      if (CLOSE_RE.test(lines[j])) {
        bodyEnd = j;
        break;
      }
    }
    if (bodyEnd === -1) {
      // No closing tag found; leave as-is (falls back to CodeGroup.astro).
      out.push(line);
      i++;
      continue;
    }

    const body = lines.slice(bodyStart, bodyEnd);
    const tabs = parseFenceTabs(body);
    if (tabs === null) {
      // Body isn't just fenced code blocks; leave the whole block untouched.
      out.push(line);
      i++;
      continue;
    }

    groups++;
    out.push('<Tabs>');
    for (const tab of tabs) {
      out.push(`<TabItem label="${escapeAttr(tab.label)}">`);
      out.push(...tab.lines);
      out.push('</TabItem>');
    }
    out.push('</Tabs>');
    i = bodyEnd + 1;
  }

  return { output: out.join('\n'), groups };
}

/**
 * Parse a <CodeGroup> body into a list of { label, lines } tabs, one per
 * fenced code block. Returns null if the body contains anything other than
 * fenced code blocks and blank lines.
 */
function parseFenceTabs(bodyLines) {
  const tabs = [];
  let i = 0;
  while (i < bodyLines.length) {
    const line = bodyLines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    const marker = fenceDelimiter(line);
    if (marker === null) return null;

    const infoMatch = /^\s*`{3,}(.*)$/.exec(line);
    const info = infoMatch[1].trim();
    const [lang, ...labelWords] = info.split(/\s+/).filter(Boolean);
    const label = labelWords.join(' ') || lang || 'Code';

    const fenceLines = [`${marker}${lang ?? ''}`.trimEnd()];
    let j = i + 1;
    let closed = false;
    for (; j < bodyLines.length; j++) {
      const inner = bodyLines[j];
      if (fenceDelimiter(inner) !== null) {
        fenceLines.push(inner.trim());
        closed = true;
        break;
      }
      fenceLines.push(inner);
    }
    if (!closed) return null;

    tabs.push({ label, lines: fenceLines });
    i = j + 1;
  }
  return tabs.length > 0 ? tabs : null;
}
