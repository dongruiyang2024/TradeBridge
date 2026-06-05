import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type PluginOption } from "vite";

const ONETALK_PAGE_SCRIPT_OUTPUT = "channels/alibaba-im/onetalk-page-script.js";
const configDir = fileURLToPath(new URL(".", import.meta.url));

export function wrapClassicScriptInIife(code: string): string {
  return `(function () {\n${code}\n})();\n`;
}

export function createOneTalkPageScriptIifePlugin(): PluginOption {
  return {
    name: "tradebridge-onetalk-page-script-iife",
    generateBundle(_outputOptions, bundle) {
      const output = bundle[ONETALK_PAGE_SCRIPT_OUTPUT];
      if (!output || output.type !== "chunk") return;
      if (output.imports.length || output.dynamicImports.length) {
        this.error(`${ONETALK_PAGE_SCRIPT_OUTPUT} must stay a single classic script chunk`);
      }
      output.code = wrapClassicScriptInIife(output.code);
    }
  };
}

export default defineConfig({
  root: "src",
  publicDir: "../public",
  plugins: [createOneTalkPageScriptIifePlugin()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        "background/index": resolve(configDir, "src/background/index.ts"),
        "channels/alibaba-im/onetalk-page-bridge": resolve(configDir, "src/channels/alibaba-im/onetalk-page-bridge.ts"),
        "channels/alibaba-im/onetalk-page-script": resolve(configDir, "src/channels/alibaba-im/onetalk-page-script.ts"),
        "popup/popup": resolve(configDir, "src/popup/popup.html"),
        "options/options": resolve(configDir, "src/options/options.html")
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
