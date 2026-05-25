import os from "node:os";
import path from "node:path";

export const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "../../..");

export const API_VERSION = "0.1.0";

export const SERVER_HOST = process.env.WANGWANG_HOST || "127.0.0.1";
export const SERVER_PORT = Number(process.env.WANGWANG_PORT || 5031);
export const LOCAL_API_TOKEN = process.env.WANGWANG_API_TOKEN || "";

export const EXPORTS_DIR = path.resolve(WORKSPACE_ROOT, "exports");

export const LOG_PATHS = envPathList("WANGWANG_LOG_PATHS") || defaultLogPaths();
export const COOKIE_DB_PATHS = envPathList("WANGWANG_COOKIE_DB_PATHS") || [];

function envPathList(name: string): string[] | null {
  const raw = process.env[name];
  if (!raw) return null;
  return raw
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function defaultLogPaths(): string[] {
  if (process.platform === "darwin") {
    return [path.join(os.homedir(), "Library", "Application Support", "AliWorkbenchTemp", "cef.log")];
  }
  if (process.platform === "win32") {
    return [
      "D:\\AlibabaSupplierData\\app.log",
      path.join(process.env.LOCALAPPDATA || "C:\\Users\\wait9yan\\AppData\\Local", "AliWorkbenchTemp", "cef.log")
    ];
  }
  return [];
}
