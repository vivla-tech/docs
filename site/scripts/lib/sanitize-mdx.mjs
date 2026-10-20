// Technical MDX safety net — not a content edit.
//
// Mintlify's MDX parser tolerates a few things Astro's stricter MDX compiler
// (@mdx-js/mdx) doesn't, all used as plain text in this corpus:
//
//   1. Bare `<` / `{` in prose, used as literal placeholders (e.g.
//      "Coste real a <día>", "Enviar a {nombre}"), which MDX's JSX/
//      expression parser tries to parse instead of treating as text.
//   2. An inline code span delimited by 3+ backticks (reserved for a fenced
//      code block in most Markdown, but valid inline too — used here to
//      wrap `/`- or backtick-free text like a file tree) right inside a
//      JSX element's children, e.g. `<Tab>```tree```</Tab>`. MDX's JSX+
//      Markdown tokenizer loses track of the enclosing tag in that case.
//
// Both are fixed here as pure syntax rewrites — backslash-escaping `<`/`{`,
// and shrinking an over-long inline-span delimiter down to a single
// backtick when the content has none of its own — so the rendered page is
// byte-for-byte the same as before. Fenced code blocks, and anything that
// looks like one of our supported components (see KNOWN_TAGS), are left
// untouched.

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
 * Split source lines (frontmatter already removed) into alternating runs of
 * fenced-code lines (left completely untouched) and prose lines (joined
 * back into one block of text for the character-level pass below, so an
 * inline code span that crosses a line break is handled as one unit).
 */
function splitFenceSegments(lines) {
  const segments = [];
  let inFence = false;
  let current = [];
  for (const line of lines) {
    if (fenceDelimiter(line) !== null) {
      if (!inFence) {
        if (current.length > 0) segments.push({ fence: false, lines: current });
        current = [line];
      } else {
        current.push(line);
        segments.push({ fence: true, lines: current });
        current = [];
      }
      inFence = !inFence;
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) segments.push({ fence: inFence, lines: current });
  return segments;
}

/**
 * Character-level pass over one prose segment: escapes bare `<`/`{`, and
 * shrinks backtick-delimited inline code spans (3+ backticks, no backtick in
 * their own content) down to a single backtick.
 */
function sanitizeProse(text) {
  let result = '';
  let escapes = 0;
  let i = 0;
  let inTag = false;
  // Set while inside an inline code span: the delimiter run length that
  // will close it, and a buffer of its content seen so far.
  let spanOpenLength = 0;
  let spanBuffer = '';

  while (i < text.length) {
    const ch = text[i];

    if (ch === '`') {
      let runLength = 0;
      while (text[i + runLength] === '`') runLength++;
      const run = text.slice(i, i + runLength);

      if (spanOpenLength === 0) {
        spanOpenLength = runLength;
        spanBuffer = '';
      } else if (runLength === spanOpenLength) {
        // Closing delimiter: shrink a 3+ backtick span with no backtick of
        // its own content down to a single backtick (see module comment).
        const delimiter = spanOpenLength >= 3 && !spanBuffer.includes('`') ? '`' : run;
        result += delimiter + spanBuffer + delimiter;
        spanOpenLength = 0;
        spanBuffer = '';
      } else {
        // A different-length run inside a span is literal content.
        spanBuffer += run;
      }
      i += runLength;
      continue;
    }

    if (spanOpenLength > 0) {
      spanBuffer += ch;
      i++;
      continue;
    }

    if (ch === '<') {
      const rest = text.slice(i);
      const match = TAG_START_RE.exec(rest);
      const tagName = match ? match[1] : null;
      if (tagName && KNOWN_TAGS.has(tagName)) {
        inTag = true;
        result += ch;
        i++;
        continue;
      }
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

  // An unterminated span at the end of a segment (shouldn't happen in
  // practice) is flushed as-is, delimiter included, rather than dropped.
  if (spanOpenLength > 0) {
    result += '`'.repeat(spanOpenLength) + spanBuffer;
  }

  return { text: result, escapes };
}

/**
 * @param {string} source raw MDX file content (frontmatter included)
 * @returns {{ output: string, escapes: number }}
 */
export function sanitizeMdx(source) {
  const allLines = source.split('\n');

  // Never touch the YAML frontmatter block — it's not prose, and nothing
  // in it should be treated as a tag, an expression, or code.
  let start = 0;
  const header = [];
  if (allLines[0] === '---') {
    const closing = allLines.indexOf('---', 1);
    if (closing !== -1) {
      header.push(...allLines.slice(0, closing + 1));
      start = closing + 1;
    }
  }

  const segments = splitFenceSegments(allLines.slice(start));
  const outParts = [...header];
  let escapes = 0;

  for (const segment of segments) {
    if (segment.fence) {
      outParts.push(...segment.lines);
      continue;
    }
    const { text, escapes: segmentEscapes } = sanitizeProse(segment.lines.join('\n'));
    escapes += segmentEscapes;
    outParts.push(text);
  }

  return { output: outParts.join('\n'), escapes };
}
