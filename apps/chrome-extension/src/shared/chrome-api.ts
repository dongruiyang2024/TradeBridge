export interface ChromeStorageArea {
  get(keys?: string[] | Record<string, unknown> | string | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface ChromeRuntimeMessageSender {
  tab?: { id?: number; url?: string };
}

export interface ChromeRuntimeApi {
  onInstalled: {
    addListener(callback: () => void): void;
  };
  onStartup?: {
    addListener(callback: () => void): void;
  };
  onMessage: {
    addListener(
      callback: (
        message: unknown,
        sender: ChromeRuntimeMessageSender,
        sendResponse: (response?: unknown) => void
      ) => boolean | void
    ): void;
  };
  sendMessage(message: unknown): Promise<unknown>;
  getURL(path: string): string;
  openOptionsPage(): void;
}

export interface ChromeAlarmsApi {
  create(name: string, alarmInfo: { periodInMinutes?: number; delayInMinutes?: number }): void;
  onAlarm: {
    addListener(callback: (alarm: { name: string }) => void): void;
  };
}

export interface ChromeTab {
  id?: number;
  url?: string;
  active?: boolean;
}

export interface ChromeTabsApi {
  query(queryInfo: { url?: string | string[]; active?: boolean; currentWindow?: boolean }): Promise<ChromeTab[]>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

export interface ChromeScriptingApi {
  executeScript(injection: { target: { tabId: number }; files: string[] }): Promise<unknown[]>;
}

export interface ChromePermissionsRequest {
  origins?: string[];
  permissions?: string[];
}

export interface ChromePermissionsApi {
  contains(permissions: ChromePermissionsRequest): Promise<boolean>;
  request(permissions: ChromePermissionsRequest): Promise<boolean>;
}

export interface ChromeApi {
  runtime: ChromeRuntimeApi;
  storage: {
    local: ChromeStorageArea;
  };
  alarms: ChromeAlarmsApi;
  tabs?: ChromeTabsApi;
  scripting?: ChromeScriptingApi;
  permissions?: ChromePermissionsApi;
}

export function getChrome(): ChromeApi {
  return (globalThis as unknown as { chrome: ChromeApi }).chrome;
}
