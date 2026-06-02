export type CookieJar = Record<string, string>;

export function getCtoken(cookies: CookieJar): string {
  const raw = cookies.xman_us_t || "";
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const params = new URLSearchParams(decoded);
  return params.get("ctoken") || params.get(" ctoken") || "";
}

export function csrfQuery(cookies: CookieJar): string {
  const params = new URLSearchParams();
  const ctoken = getCtoken(cookies);
  const tbToken = cookies._tb_token_ || "";
  if (ctoken) params.set("ctoken", ctoken);
  if (tbToken) params.set("_tb_token_", tbToken);
  return params.toString();
}

export function cookieHeader(cookies: CookieJar): string {
  return Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}
