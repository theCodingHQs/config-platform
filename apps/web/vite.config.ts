import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const univer = [
  "@univerjs/core",
  "@univerjs/design",
  "@univerjs/docs",
  "@univerjs/docs-ui",
  "@univerjs/engine-formula",
  "@univerjs/engine-render",
  "@univerjs/sheets",
  "@univerjs/sheets-formula",
  "@univerjs/sheets-formula-ui",
  "@univerjs/sheets-numfmt",
  "@univerjs/sheets-numfmt-ui",
  "@univerjs/sheets-ui",
  "@univerjs/ui",
];

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: [...univer, "@wendellhu/redi", "react", "react-dom"],
  },
  optimizeDeps: {
    include: [...univer, "@wendellhu/redi", "@wendellhu/redi/react-bindings"],
  },
  server: {
    port: 3000,
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./tests/setup.ts",
  },
});
