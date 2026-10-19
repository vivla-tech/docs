// Technical MDX safety net — not a content edit.
//
// Mintlify's MDX parser tolerates a few bare `<` and `{` characters in prose
// (used as literal placeholders, e.g. "Coste real a <día>" or "Enviar a
// {nombre}"). Astro's MDX compiler (@mdx-js/mdx) is stricter: a bare `<` that
// looks like it could start a tag, or a bare `{` outside a known component's
// attribute list, is parsed as JSX/an expression and breaks the build.
//
// This scanner finds exactly those characters outside fenced code blocks and
// inline code spans, and backslash-escapes them (`\<`, `\{`). MDX treats a
// backslash-escaped character as literal text, so the rendered page is
// byte-for-byte the same as before — this is a syntax fix, not a visual or
// semantic change. Anything that looks like one of our supported components
// (see KNOWN_TAGS) is left untouched.

export const KNOWN_TAGS = new Set([
  // Mintlify compatibility components (site/src/components/mintlify)
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
  // Plain HTML that may legitimately appear in prose
  'a',
  'b',
  'i',
  'u',
  'p',
  'div',
  'span',
  'br',
  'hr',
  'img',
  'details',
  'summary',
  'code',
  'pre',
  'em',
  'strong',
  'sup',
  'sub',
  'kbd',
  'mark',
  'small',
  'ol',
  'ul',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
]);

const TAG_START_RE = /^<\/?([A-Za-z][A-Za-z0-9]*)/;

// Box-drawing characters used for ASCII file-tree diagrams. A couple of
// pages in this corpus wrap a tree like this in a triple-backtick *inline*
// span (e.g. inside a `<Tab>`) rather than a block fence; no real fence info
// string or title ever contains one of these.
const TREE_CHARS_RE = /[├│└─┌┬┐┼┴┘]/;

/**
 * True if `line` is the start/end of a real fenced code block, as opposed to
 * an inline code span that happens to use a 3+ backtick/tilde delimiter and
 * closes on the same line (e.g. `` <Tab>```tree```</Tab> ``) or wraps a file
 * tree across two lines without ever being alone on its own line. A genuine
 * fence marker line never has another copy of its own delimiter character
 * later on the same line, and its info string is plain text.
 */
export function fenceDelimiter(line) {
  const match = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  const [, marker, rest] = match;
  const delimiterChar = marker[0];
  if (rest.includes(delimiterChar)) return null;
  if (TREE_CHARS_RE.test(rest)) return null;
  return marker;
}

/**
 * @param {string} source raw MDX file content (frontmatter included)
 * @returns {{ output: string, escapes: number }}
 */
export function sanitizeMdx(source) {
  const lines = source.split('\n');
  const out = [];
  let inFence = false;
  let codeSpanRunLength = 0; // 0 = not inside an inline code span
  let inTag = false;
  let escapes = 0;

  // Never touch the YAML frontmatter block — it's not prose, and nothing
  // in it should be treated as a tag or an expression.
  let start = 0;
  if (lines[0] === '---') {
    const closing = lines.indexOf('---', 1);
    if (closing !== -1) {
      out.push(...lines.slice(0, closing + 1));
      start = closing + 1;
    }
  }

  for (const line of lines.slice(start)) {
    if (fenceDelimiter(line) !== null) {
      out.push(line);
      inFence = !inFence;
      // A fence boundary always closes any inline context.
      codeSpanRunLength = 0;
      inTag = false;
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    let result = '';
    let i = 0;
    while (i < line.length) {
      const ch = line[i];

      if (ch === '`') {
        let runLength = 0;
        while (line[i + runLength] === '`') runLength++;
        const run = line.slice(i, i + runLength);
        if (codeSpanRunLength === 0) {
          codeSpanRunLength = runLength;
        } else if (runLength === codeSpanRunLength) {
          codeSpanRunLength = 0;
        }
        // A different-length run while inside a span is literal content.
        result += run;
        i += runLength;
        continue;
      }
      if (codeSpanRunLength > 0) {
        result += ch;
        i++;
        continue;
      }

      if (ch === '<') {
        const rest = line.slice(i);
        const match = TAG_START_RE.exec(rest);
        const tagName = match ? match[1] : null;
        if (tagName && KNOWN_TAGS.has(tagName)) {
          inTag = true;
          result += ch;
          i++;
          continue;
        }
        // Not a recognized tag: treat as literal text.
        result += '\\<';
        escapes++;
        i++;
        continue;
      }

      if (ch === '>' && inTag) {
        inTag = false;
        result += ch;
        i++;
        continue;
      }

      if (ch === '{' && !inTag) {
        result += '\\{';
        escapes++;
        i++;
        continue;
      }

      result += ch;
      i++;
    }
    out.push(result);
  }

  return { output: out.join('\n'), escapes };
}
