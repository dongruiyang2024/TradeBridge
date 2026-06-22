import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type PluginOption } from "vite";

const CLASSIC_PAGE_SCRIPT_OUTPUTS = [
  "channels/alibaba-im/onetalk-page-script.js",
  "channels/whatsapp-web/whatsapp-page-script.js"
];
const configDir = fileURLToPath(new URL(".", import.meta.url));

export function wrapClassicScriptInIife(code: string): string {
  return `(function () {\n${code}\n})();\n`;
}

export function createPageScriptIifePlugin(): PluginOption {
  return {
    name: "tradebridge-page-script-iife",
    generateBundle(_outputOptions, bundle) {
      for (const outputName of CLASSIC_PAGE_SCRIPT_OUTPUTS) {
        const output = bundle[outputName];
        if (!output || output.type !== "chunk") continue;
        if (output.imports.length || output.dynamicImports.length) {
          this.error(`${outputName} must stay a single classic script chunk`);
        }
        output.code = wrapClassicScriptInIife(output.code);
      }
    }
  };
}

export const createOneTalkPageScriptIifePlugin = createPageScriptIifePlugin;

export default defineConfig({
  root: "src",
  publicDir: "../public",
  plugins: [createPageScriptIifePlugin()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        "background/index": resolve(configDir, "src/background/index.ts"),
        "channels/alibaba-im/onetalk-page-bridge": resolve(configDir, "src/channels/alibaba-im/onetalk-page-bridge.ts"),
        "channels/alibaba-im/onetalk-page-script": resolve(configDir, "src/channels/alibaba-im/onetalk-page-script.ts"),
        "channels/whatsapp-web/whatsapp-page-bridge": resolve(configDir, "src/channels/whatsapp-web/whatsapp-page-bridge.ts"),
        "channels/whatsapp-web/whatsapp-page-script": resolve(configDir, "src/channels/whatsapp-web/whatsapp-page-script.ts"),
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
