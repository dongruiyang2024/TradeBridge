import type { WeblitePageSnapshot } from "@wangwang/onetalk-adapter/browser";
import { getChrome } from "../shared/chrome-api.js";
import {
  isStoredOnetalkPageSnapshot,
  ONETALK_PAGE_SNAPSHOT_STORAGE_KEY
} from "../shared/onetalk-page-snapshot.js";

const MAX_SNAPSHOT_AGE_MS = 10 * 60 * 1000;

export async function readLatestOnetalkPageSnapshot(): Promise<WeblitePageSnapshot | undefined> {
  try {
    const storage = getChrome().storage.local;
    const values = await storage.get(ONETALK_PAGE_SNAPSHOT_STORAGE_KEY);
    const stored = values[ONETALK_PAGE_SNAPSHOT_STORAGE_KEY];
    if (!isStoredOnetalkPageSnapshot(stored)) return undefined;
    if (!stored.url.includes("onetalk.alibaba.com")) return undefined;
    const savedAt = Date.parse(stored.savedAt);
    if (Number.isNaN(savedAt) || Date.now() - savedAt > MAX_SNAPSHOT_AGE_MS) return undefined;
    return stored.snapshot;
  } catch {
    return undefined;
  }
}
