export interface BoundedIntegerOptions {
  fallback: number;
  min: number;
  max: number;
}

export function normalizeServerUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid_server_url");
    return url.origin;
  } catch {
    throw new Error("invalid_server_url");
  }
}

export function serverHostPermissionPatterns(serverUrl: string): string[] {
  const url = new URL(normalizeServerUrl(serverUrl));
  return [`${url.protocol}//${url.host}/*`];
}

export function boundedInteger(value: FormDataEntryValue | number | string | null, options: BoundedIntegerOptions): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return options.fallback;
  if (parsed < options.min) return options.min;
  if (parsed > options.max) return options.max;
  return parsed;
}
