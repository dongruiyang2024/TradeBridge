import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export interface LoadWorkspaceEnvOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  filenames?: string[];
  override?: boolean;
}

const DEFAULT_FILENAMES = [".env.local", ".env"];
const require = createRequire(import.meta.url);
const parseEnv = loadDotenvParser();

export function loadWorkspaceEnv(options: LoadWorkspaceEnvOptions = {}): string[] {
  const env = options.env || process.env;
  const root = findWorkspaceRoot(options.cwd || process.cwd());
  const filenames = options.filenames || DEFAULT_FILENAMES;
  const loaded: string[] = [];

  for (const filename of filenames) {
    const filePath = path.join(root, filename);
    if (!existsSync(filePath)) continue;

    const parsed = parseEnv(readFileSync(filePath, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (options.override || env[key] === undefined) {
        env[key] = value;
      }
    }
    loaded.push(filePath);
  }

  return loaded;
}

export function findWorkspaceRoot(cwd: string = process.cwd()): string {
  let current = path.resolve(cwd);

  while (true) {
    if (isWorkspaceRoot(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(cwd);
    current = parent;
  }
}

function isWorkspaceRoot(directory: string): boolean {
  const packageJsonPath = path.join(directory, "package.json");
  if (!existsSync(packageJsonPath)) return false;

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { workspaces?: unknown };
    return Array.isArray(packageJson.workspaces) || isWorkspaceObject(packageJson.workspaces);
  } catch {
    return false;
  }
}

function isWorkspaceObject(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && Array.isArray((value as { packages?: unknown }).packages));
}

type EnvParser = (source: string) => Record<string, string>;

function loadDotenvParser(): EnvParser {
  try {
    const dotenv = require("dotenv") as { parse?: EnvParser };
    if (typeof dotenv.parse === "function") return dotenv.parse;
  } catch {
    // Keep local development usable until dependencies are installed.
  }
  return fallbackParse;
}

function fallbackParse(source: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!match) continue;

    const [, key, rawValue = ""] = match;
    let value = rawValue.trim();
    if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    } else {
      const commentIndex = value.indexOf(" #");
      if (commentIndex >= 0) value = value.slice(0, commentIndex).trim();
    }
    env[key] = value;
  }

  return env;
}
