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
  openOptionsPage(): void;
}

export interface ChromeAlarmsApi {
  create(name: string, alarmInfo: { periodInMinutes?: number; delayInMinutes?: number }): void;
  onAlarm: {
    addListener(callback: (alarm: { name: string }) => void): void;
  };
}

export interface ChromeCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
}

export interface ChromeCookiesApi {
  getAll(details: { domain?: string; url?: string; name?: string }): Promise<ChromeCookie[]>;
}

export interface ChromeApi {
  runtime: ChromeRuntimeApi;
  storage: {
    local: ChromeStorageArea;
  };
  alarms: ChromeAlarmsApi;
  cookies?: ChromeCookiesApi;
}

export function getChrome(): ChromeApi {
  return (globalThis as unknown as { chrome: ChromeApi }).chrome;
}
