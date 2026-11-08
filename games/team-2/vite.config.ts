import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths: the same build works at the root of a domain and under a path like /team-2/.
  base: "./",
  server: { port: 5173, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
