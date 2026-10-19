import { describe, expect, it } from "vitest";
import { tryServeGeneratedPage } from "../src/pages";

describe("tryServeGeneratedPage", () => {
  it("renders a page's .md form as title/description/body", async () => {
    const res = tryServeGeneratedPage("/operativa/reservas-ultima-hora.md", "https://wiki.vivla.com");
    expect(res).not.toBeNull();
    const text = await res!.text();
    expect(text).toContain("# Reservas de última hora");
    expect(text).toContain("> Operativa actual del sistema de reservas de última hora");
  });

  it("returns null for a page that doesn't exist", () => {
    expect(tryServeGeneratedPage("/does/not/exist.md", "https://wiki.vivla.com")).toBeNull();
  });

  it("renders llms.txt with the given base URL substituted", async () => {
    const res = tryServeGeneratedPage("/llms.txt", "https://wiki-next.vivla.com");
    expect(res).not.toBeNull();
    const text = await res!.text();
    expect(text).toContain("https://wiki-next.vivla.com/");
    expect(text).not.toContain("{{BASE_URL}}");
  });

  it("renders llms-full.txt with full page bodies inlined", async () => {
    const res = tryServeGeneratedPage("/llms-full.txt", "https://wiki.vivla.com");
    expect(res).not.toBeNull();
    const text = await res!.text();
    expect(text).toContain("# Reservas de última hora");
  });

  it("leaves non-generated paths alone", () => {
    expect(tryServeGeneratedPage("/favicon.svg", "https://wiki.vivla.com")).toBeNull();
  });
});
