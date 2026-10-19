import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // The AI binding has no local simulation — by default the pool opens
      // a *remote* proxy session for it, which needs real Cloudflare auth
      // this VPS doesn't have (and shouldn't: Workers AI calls for this
      // project happen from the Mac's authenticated `cf` profile, per the
      // task's own instructions). `remoteBindings: false` skips that; tests
      // that exercise the dense/hybrid path mock env.AI.run() themselves —
      // see test/search.test.ts.
      remoteBindings: false,
    }),
  ],
});
