import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
  },
  plugins: [
    cloudflareTest({
      // wrangler.test.jsonc, not wrangler.jsonc: the AI binding has no
      // local simulation and crashes the miniflare worker outright when
      // declared with no real Cloudflare auth available (this VPS has
      // none, by design — real Workers AI calls for this project run from
      // the Mac's authenticated `cf` profile). See that file's comment.
      wrangler: { configPath: "./wrangler.test.jsonc" },
      remoteBindings: false,
    }),
  ],
});
