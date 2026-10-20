import { describe, expect, it } from "vitest";
import { runFilesystemCommand } from "../src/filesystem";

describe("runFilesystemCommand", () => {
  it("hides the just-bash plumbing dirs from a bare `ls /`", async () => {
    const out = await runFilesystemCommand("ls /");
    expect(out).toContain("tools");
    expect(out).toContain("backend");
    for (const noise of ["bin", "dev", "proc", "usr"]) {
      expect(out.split("\n")).not.toContain(noise);
    }
  });

  it("does not filter a real subdirectory listing", async () => {
    const out = await runFilesystemCommand("ls /tools");
    expect(out).toContain("exit: 0");
  });

  it("hides the plumbing subtrees from `tree / -L 2`", async () => {
    const out = await runFilesystemCommand("tree / -L 2");
    expect(out).not.toContain("bin");
    expect(out).not.toContain("/proc");
    expect(out).toContain("tools");
  });

  it("reads a real page as `# title\\n\\n> description\\n\\n<body>`, keeping the body's own differently-worded H1", async () => {
    // Body opens with "# Operativa de reservas de última hora" — different
    // text from the frontmatter title, so both headings stay (confirmed
    // against the live Mintlify server).
    const out = await runFilesystemCommand("cat /operativa/reservas-ultima-hora.mdx");
    expect(out).toContain("exit: 0");
    expect(out).toContain("# Reservas de última hora\n\n> Operativa actual del sistema de reservas de última hora");
    expect(out).toContain("# Operativa de reservas de última hora");
  });

  it("drops the body's leading H1 when it exactly repeats the frontmatter title", async () => {
    // Confirmed against the live Mintlify server: 92 of 121 pages have a
    // body that opens with "# <exact same title>" — Mintlify renders it
    // once, not twice.
    const out = await runFilesystemCommand("cat /tools/api/conventions.mdx");
    const occurrences = out.split("# Convenciones API").length - 1;
    expect(occurrences).toBe(1);
  });

  it("reports a missing path like the live Mintlify server does — no empty stdout section", async () => {
    const out = await runFilesystemCommand("ls /nope");
    expect(out).toBe("exit: 2\n--- stderr ---\nls: /nope: No such file or directory\n");
  });

  it("never persists a write across calls", async () => {
    await runFilesystemCommand("echo hi > /scratch.txt");
    const out = await runFilesystemCommand("cat /scratch.txt");
    expect(out).toContain("exit:");
    expect(out).not.toContain("exit: 0");
  });

  it("truncates output over 30KB with a [truncated] marker", async () => {
    // tools/homes/index.mdx is ~110KB — the single largest page in the corpus.
    const out = await runFilesystemCommand("cat /tools/homes/index.mdx");
    const bytes = new TextEncoder().encode(out).length;
    expect(bytes).toBeLessThanOrEqual(30 * 1024 + "\n[truncated]".length);
    expect(out.endsWith("[truncated]")).toBe(true);
  });
});
