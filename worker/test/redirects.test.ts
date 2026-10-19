import { describe, expect, it } from "vitest";
import { resolveRedirect } from "../src/redirects";

describe("resolveRedirect", () => {
  it("redirects a long-form index page to its short Starlight slug", () => {
    expect(resolveRedirect("/tools/index")).toBe("/tools");
    expect(resolveRedirect("/operativa/index")).toBe("/operativa");
  });

  it("redirects the docs.json-declared panel guide moves", () => {
    expect(resolveRedirect("/panel/guides/account-setup")).toBe("/panel/account-setup");
    expect(resolveRedirect("/panel/guides/create-booking")).toBe("/panel/bookings/create-booking");
    expect(resolveRedirect("/panel/guides/assign-keys")).toBe("/panel/keys/assign-keys");
    expect(resolveRedirect("/panel/guides/create-user")).toBe("/panel/users/create-user");
  });

  it("returns null for a page that already has a short slug", () => {
    expect(resolveRedirect("/architecture")).toBeNull();
    expect(resolveRedirect("/operativa/reservas")).toBeNull();
  });

  it("returns null for an unknown path", () => {
    expect(resolveRedirect("/nope")).toBeNull();
  });
});
