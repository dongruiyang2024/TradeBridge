import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src",
  publicDir: "../public",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        "background/index": resolve(__dirname, "src/background/index.ts"),
        "content/onetalk-page-bridge": resolve(__dirname, "src/content/onetalk-page-bridge.ts"),
        "content/onetalk-page-script": resolve(__dirname, "src/content/onetalk-page-script.ts"),
        "popup/popup": resolve(__dirname, "src/popup/popup.html"),
        "options/options": resolve(__dirname, "src/options/options.html")
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
