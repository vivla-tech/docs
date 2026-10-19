// query_docs_filesystem_vivla_docs backend: just-bash (Vercel Labs,
// Apache-2.0) over an in-memory filesystem seeded from corpus.json. A fresh
// `Bash` instance is created per call so writes never persist across calls —
// see decision in plan §6.2 ("Safety").
import { Bash } from "just-bash";
import { corpus, pageFsBody } from "./content";

const MAX_OUTPUT_BYTES = 30 * 1024;
const MAX_EXECUTION_TIME_MS = 10_000;

function buildFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [path, page] of Object.entries(corpus.pages)) {
    files[`/${path}.mdx`] = pageFsBody(page);
  }
  return files;
}

// Precomputed once per isolate. `new Bash({ files: FILES })` below still
// gives every call its own in-memory copy — just-bash never mutates the
// object it was constructed with.
const FILES = buildFiles();

function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

function truncateToBytes(s: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length <= maxBytes) return s;
  let decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, maxBytes));
  // A truncation that lands mid-codepoint decodes the dangling bytes as a
  // single U+FFFD — drop it rather than ship a stray replacement glyph.
  if (decoded.endsWith("�")) decoded = decoded.slice(0, -1);
  return decoded;
}

// --- Cosmetic parity fix -----------------------------------------------
// just-bash's virtual filesystem always seeds /bin (one file per built-in
// command), /dev, /proc and /usr alongside whatever `files` it's given —
// that's how the shell resolves command binaries, not something we can turn
// off. Mintlify's tool description promises a filesystem that "contains
// ONLY the VIVLA Docs documentation pages", and `tree / -L 2` / `ls /` are
// the exact commands its own description tells agents to run first. Strip
// that plumbing from those two specific, root-targeted invocations so the
// exploration experience matches; leave every other command (including any
// listing of a real subdirectory) untouched.
const RESERVED_ROOT_ENTRIES = new Set(["bin", "dev", "proc", "usr"]);

function isPlainLsOnRoot(command: string): boolean {
  const m = command.trim().match(/^ls(?:\s+(-[a-zA-Z]+))?(?:\s+(\/))?\s*$/);
  if (!m) return false;
  const flags = m[1] ?? "";
  return !flags.includes("l"); // long format (-l/-la) differs; leave it alone.
}

function isTreeOnRoot(command: string): boolean {
  const trimmed = command.trim();
  if (!/^tree\b/.test(trimmed)) return false;
  const tokens = trimmed.slice(4).trim().split(/\s+/).filter(Boolean);
  const positional: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "-L") {
      i++;
      continue;
    } // skip the depth argument
    if (t.startsWith("-")) continue;
    positional.push(t);
  }
  return positional.length === 0 || (positional.length === 1 && positional[0] === "/");
}

function stripLsRootNoise(stdout: string): string {
  return stdout
    .split("\n")
    .filter((line) => !RESERVED_ROOT_ENTRIES.has(line.trim()))
    .join("\n");
}

function stripTreeRootNoise(stdout: string): string {
  const lines = stdout.split("\n");
  const kept: string[] = [];
  let pruning = false;
  let pruned = false;
  for (const line of lines) {
    if (pruning) {
      if (/^(\| {3}| {4})/.test(line)) continue; // depth >= 2 continuation of the pruned subtree
      pruning = false;
    }
    const rootEntry = line.match(/^[|`]-- (.+)$/);
    if (rootEntry && RESERVED_ROOT_ENTRIES.has(rootEntry[1])) {
      pruning = true;
      pruned = true;
      continue;
    }
    kept.push(line);
  }
  if (!pruned) return stdout;
  // The trailing "N directories, M files" summary no longer matches the
  // pruned listing — drop it rather than show a wrong count.
  return kept.filter((l) => !/^\d+ director(y|ies), \d+ files?$/.test(l.trim())).join("\n");
}

function stripVirtualFsPlumbing(command: string, stdout: string): string {
  if (isPlainLsOnRoot(command)) return stripLsRootNoise(stdout);
  if (isTreeOnRoot(command)) return stripTreeRootNoise(stdout);
  return stdout;
}
// -------------------------------------------------------------------------

export async function runFilesystemCommand(command: string): Promise<string> {
  const bash = new Bash({
    files: FILES,
    cwd: "/",
    executionLimitProfile: "hardened",
    executionLimits: { maxExecutionTimeMs: MAX_EXECUTION_TIME_MS },
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAX_EXECUTION_TIME_MS);
  let result;
  try {
    result = await bash.exec(command, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  const stdout = stripVirtualFsPlumbing(command, result.stdout);
  let text = `exit: ${result.exitCode}\n--- stdout ---\n${stdout}`;
  if (result.stderr) text += `\n--- stderr ---\n${result.stderr}`;

  if (utf8ByteLength(text) > MAX_OUTPUT_BYTES) {
    text = `${truncateToBytes(text, MAX_OUTPUT_BYTES)}\n[truncated]`;
  }
  return text;
}
