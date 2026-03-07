import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react()],

  // Tauri expects a fixed port in dev
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },

  // Entry point
  root: ".",
  build: {
    outDir: "dist",
    target: "esnext",
    minify: "esbuild",
  },

  // Resolve
  resolve: {
    alias: {
      "@": "/src",
    },
  },
});
