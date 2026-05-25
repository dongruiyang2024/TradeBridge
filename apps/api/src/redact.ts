const SENSITIVE_KEY_PARTS = ["token", "cookie", "password", "secret", "session"];

const SENSITIVE_STRING_PATTERNS = [
  /(chatToken|ctoken|_tb_token_|cookie2|sgcookie|tfstk|xman_[a-z_]+|xman)\s*=\s*([^&\s"'<>]+)/gi,
  /("(?:chatToken|ctoken|_tb_token_|cookie2|sgcookie|tfstk|xman_[a-z_]+|xman)"\s*:\s*")([^"]+)/gi
];

export function sanitizeValue(value: unknown, redactIds = false): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, redactIds));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (SENSITIVE_KEY_PARTS.some((part) => lower.includes(part))) continue;
      if (redactIds && (lower.endsWith("id") || lower.endsWith("ids") || lower.includes("account") || lower.includes("aliid"))) {
        output[key] = typeof child === "string" || typeof child === "number" ? { sha256_16: shortHash(child) } : sanitizeValue(child, redactIds);
        continue;
      }
      output[key] = sanitizeValue(child, redactIds);
    }
    return output;
  }
  if (typeof value === "string") {
    return SENSITIVE_STRING_PATTERNS.reduce(
      (text, pattern, index) => text.replace(pattern, index === 0 ? "$1=<redacted>" : "$1<redacted>"),
      value
    );
  }
  return value;
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function shortHash(value: unknown): string {
  let hash = 0x811c9dc5;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
