import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: { include: ["tests/integration/**/*.test.ts"], environment: "node", testTimeout: 60_000, fileParallelism: false },
});
