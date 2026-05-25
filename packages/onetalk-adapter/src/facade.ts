import { OnetalkClient, type ChatMessageResponse, type WebliteData } from "./onetalk-client.js";
import {
  type CookieJar,
  type ExtractCookiesOptions,
  discoverAliWorkbenchCookieDbs,
  discoverAliWorkbenchTokenCacheFiles,
  extractAliWorkbenchCookies,
  getCtoken
} from "./session.js";

export interface DetectSessionOptions extends ExtractCookiesOptions {
  logPaths?: string[];
}

export interface DetectedSession {
  cookies: CookieJar;
  cookieNames: string[];
  hasCtoken: boolean;
  hasTbToken: boolean;
  hasCookie2: boolean;
  hasSgcookie: boolean;
  logPaths: string[];
  cookieDbPaths: string[];
  tokenCachePaths: string[];
}

export interface FetchConversationsOptions extends DetectSessionOptions {
  cookies?: CookieJar;
}

export interface FetchMessagesOptions extends DetectSessionOptions {
  cookies?: CookieJar;
  conversation: Record<string, unknown>;
  bootstrap?: Record<string, string>;
  before?: number | null;
  pageSize?: number;
}

export function detectSession(options: DetectSessionOptions = {}): DetectedSession {
  const platform = options.platform || process.platform;
  const logPaths = options.logPaths || [];
  const cookieDbPaths = options.cookieDbPaths || discoverAliWorkbenchCookieDbs(options.homeDir, platform);
  const tokenCachePaths = options.tokenCachePaths || discoverAliWorkbenchTokenCacheFiles(options.homeDir, platform);
  const cookies = extractAliWorkbenchCookies(logPaths, {
    ...options,
    platform,
    cookieDbPaths,
    tokenCachePaths
  });

  return {
    cookies,
    cookieNames: Object.keys(cookies).sort(),
    hasCtoken: Boolean(getCtoken(cookies)),
    hasTbToken: Boolean(cookies._tb_token_),
    hasCookie2: Boolean(cookies.cookie2),
    hasSgcookie: Boolean(cookies.sgcookie),
    logPaths,
    cookieDbPaths,
    tokenCachePaths
  };
}

export async function fetchConversations(options: FetchConversationsOptions = {}): Promise<WebliteData> {
  const client = new OnetalkClient(resolveCookies(options));
  return client.fetchWeblite();
}

export async function fetchMessages(options: FetchMessagesOptions): Promise<ChatMessageResponse> {
  const client = new OnetalkClient(resolveCookies(options));
  return client.getChatMessages({
    conversation: options.conversation,
    bootstrap: options.bootstrap || {},
    before: options.before ?? Date.now(),
    pageSize: options.pageSize ?? 50
  });
}

function resolveCookies(options: FetchConversationsOptions | FetchMessagesOptions): CookieJar {
  if (options.cookies) return options.cookies;
  return detectSession(options).cookies;
}
