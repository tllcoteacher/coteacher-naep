import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "miniflare",
    environmentOptions: {
      // The script path is required, but will be overridden by the `main` in wrangler.jsonc
      scriptPath: "src/worker.ts",
      // We need to specify the assets binding, so our worker can load `naep.json`
      assets: "public",
    },
    ui: true,
  },
});