import { defineConfig } from "@shiptiffin/sdk/config";
export default defineConfig({
  project: "rabbit-hole",
  apps: {
    web: {
      framework: "next",
      path: ".",
      install: "bun install --frozen-lockfile",
      build: "bun --bun next build",
      release: "bun run db:migrate",
    },
  },
});
