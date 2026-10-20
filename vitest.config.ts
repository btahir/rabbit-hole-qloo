import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve("src"),
      "server-only": path.resolve("tests/server-only.ts"),
    },
  },
  test: {
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.ts", "src/lib/qloo/tests/**/*.test.ts"],
    maxWorkers: 2,
  },
});
