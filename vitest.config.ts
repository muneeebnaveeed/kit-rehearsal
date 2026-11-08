import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // .railway is listed on its own: globs skip dot folders.
    include: ["**/*.test.ts", ".railway/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**", ".claude/**"],
  },
});
