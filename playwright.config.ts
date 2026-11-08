import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./server/tests/e2e",
  use: {
    baseURL: "http://localhost:2567",
  },
});
