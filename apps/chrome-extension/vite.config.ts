import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type PluginOption } from "vite";

const CLASSIC_PAGE_SCRIPT_OUTPUTS = ["channels/alibaba-im/onetalk-page-script.js"];
export const DEFAULT_TRADEBRIDGE_SERVER_URL = "http://127.0.0.1:5032";
const configDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(configDir, "../..");

export function loadTradeBridgeServerEnv(
  mode: string,
  options: { envDir?: string; processEnv?: Record<string, string | undefined> } = {}
): Record<string, string | undefined> {
  const envDir = options.envDir || repoRoot;
  const processEnv = options.processEnv || process.env;
  const isLocalMode = mode === "development";
  if (isLocalMode) return {};

  const fileNames =
    [`.env.${mode}`, `.env.${mode}.local`];
  const env: Record<string, string | undefined> = {};

  for (const fileName of fileNames) {
    Object.assign(env, readEnvFile(resolve(envDir, fileName)));
  }

  return {
    ...env,
    ...(processEnv.TRADEBRIDGE_SERVER_URL ? { TRADEBRIDGE_SERVER_URL: processEnv.TRADEBRIDGE_SERVER_URL } : {})
  };
}

export function resolveTradeBridgeServerUrl(
  env: Record<string, string | undefined>,
  options: { requireExplicit?: boolean; mode?: string } = {}
): string {
  const explicitValue = env.TRADEBRIDGE_SERVER_URL?.trim();
  if (!explicitValue && options.requireExplicit) {
    const modeLabel = options.mode ? ` for ${options.mode} extension builds` : "";
    throw new Error(`TRADEBRIDGE_SERVER_URL must be set${modeLabel}`);
  }

  const rawValue = explicitValue || DEFAULT_TRADEBRIDGE_SERVER_URL;
  try {
    const url = new URL(rawValue);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid_tradebridge_server_url");
    return url.origin;
  } catch {
    throw new Error("TRADEBRIDGE_SERVER_URL must be a valid http(s) URL");
  }
}

function readEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim();
    env[key] = stripEnvQuotes(value);
  }
  return env;
}

function stripEnvQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

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

export default defineConfig(({ mode }) => {
  const env = loadTradeBridgeServerEnv(mode);
  const requireExplicitServerUrl = mode !== "development";
  return {
    root: "src",
    envDir: repoRoot,
    publicDir: "../public",
    plugins: [createPageScriptIifePlugin()],
    define: {
      __TRADEBRIDGE_SERVER_URL__: JSON.stringify(
        resolveTradeBridgeServerUrl(env, { requireExplicit: requireExplicitServerUrl, mode })
      )
    },
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
  };
});
