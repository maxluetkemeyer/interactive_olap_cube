import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import path from "path";

export default defineConfig({
  test: {
    browser: {
      provider: playwright(),
      enabled: false, // true
      // at least one instance is required
      instances: [{ browser: "chromium" }],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
