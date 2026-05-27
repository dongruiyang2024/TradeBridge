const SENSITIVE_KEY_PATTERNS = [
  /^cookie$/i,
  /^set-cookie$/i,
  /^authorization$/i,
  /^ctoken$/i,
  /^_tb_token_$/i,
  /^cookie2$/i,
  /^sgcookie$/i,
  /^x5sec$/i,
  /^chattoken$/i,
  /^sid$/i,
  /^reg-sid$/i,
  /^reg-uid$/i,
  /^accesstoken$/i,
  /^refreshtoken$/i,
  /token/i,
  /csrf/i
];

const SENSITIVE_TEXT_PATTERNS = [
  /(?:^|[?&;"'\s])ctoken=/i,
  /(?:^|[?&;"'\s])_tb_token_=/i,
  /(?:^|[?&;"'\s])cookie2=/i,
  /(?:^|[?&;"'\s])sgcookie=/i,
  /(?:^|[?&;"'\s])x5sec=/i,
  /(?:^|[?&;"'\s])chatToken=/i,
  /(?:^|[?&;"'\s])accessToken=/i,
  /(?:^|[?&;"'\s])refreshToken=/i,
  /Authorization:\s*/i,
  /Cookie:\s*/i,
  /Set-Cookie:\s*/i
];

export class SanitizerBlockedPayloadError extends Error {
  constructor(message = "sanitizer_blocked_payload") {
    super(message);
    this.name = "SanitizerBlockedPayloadError";
  }
}

export function sanitizeForUpload<T>(value: T): T {
  return sanitizeValue(value) as T;
}

export function assertNoSensitiveFields(value: unknown): void {
  const text = JSON.stringify(value);
  for (const pattern of SENSITIVE_TEXT_PATTERNS) {
    if (pattern.test(text)) {
      throw new SanitizerBlockedPayloadError();
    }
  }
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue;
    output[key] = sanitizeValue(child);
  }
  return output;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}
