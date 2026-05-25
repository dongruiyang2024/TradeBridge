export function extractJsonAfter(text: string, marker: string): unknown {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return null;
  let start = text.indexOf("[", markerIndex);
  const objectStart = text.indexOf("{", markerIndex);
  if (start < 0 || (objectStart >= 0 && objectStart < start)) start = objectStart;
  if (start < 0) return null;

  const open = text[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let pos = start; pos < text.length; pos += 1) {
    const char = text[pos];
    if (inString) {
      if (escape) escape = false;
      else if (char === "\\") escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(text.slice(start, pos + 1));
      }
    }
  }
  return null;
}

export function pageBootstrap(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of ["aliId", "aliIdEncrypt", "currentUserAccountId", "currentUserAccountIdEncry"]) {
    const pattern = new RegExp(`window\\.${name}\\s*=\\s*['"]([^'"]*)`);
    const match = pattern.exec(text);
    if (match?.[1]) result[name] = decodeHtml(match[1]);
  }
  return result;
}

function decodeHtml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'");
}
