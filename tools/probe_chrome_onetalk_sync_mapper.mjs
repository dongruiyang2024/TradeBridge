#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";
import { mapWebliteToSyncBatch } from "../packages/onetalk-adapter/src/sync-mapper.ts";

const args = parseArgs(process.argv.slice(2));
const timeoutMs = Number(args.timeoutMs || args.timeout || 20_000);
const probeId = `tradebridgeSyncMapperProbe_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const tmp = mkdtempSync(join(tmpdir(), "tradebridge-onetalk-sync-mapper-"));

const CUSTOMER_ID_PATHS = [
  ["contact", "accountIdEncrypt"],
  ["contact", "accountId"],
  ["contact", "aliIdEncrypt"],
  ["contact", "aliId"],
  ["latestMessage", "message", "contact", "accountIdEncrypt"],
  ["latestMessage", "message", "contact", "accountId"],
  ["latestMessage", "message", "contact", "aliIdEncrypt"],
  ["latestMessage", "message", "contact", "aliId"],
  ["accountIdEncrypt"],
  ["accountId"],
  ["aliIdEncrypt"],
  ["aliId"]
];

const CUSTOMER_NAME_PATHS = [
  ["contact", "name"],
  ["latestMessage", "message", "contact", "name"],
  ["name"]
];

try {
  const startResult = executeChromeJavascript(buildStartProbeJavascript({ probeId, timeoutMs }));
  if (startResult !== "started") {
    printJson({ ok: false, error: "probe_start_failed", startResult });
    process.exitCode = 1;
  } else {
    const deadline = Date.now() + timeoutMs;
    let output = "";
    while (Date.now() < deadline) {
      output = executeChromeJavascript(buildPollJavascript(probeId));
      if (output) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }
    if (!output) {
      printJson({ ok: false, error: "probe_timeout" });
      process.exitCode = 1;
    } else {
      const page = JSON.parse(output);
      const conversations = Array.isArray(page.conversations) ? page.conversations.filter(isRecord) : [];
      const batch = mapWebliteToSyncBatch({
        sellerAccount: { externalAccountId: "default-seller" },
        device: { deviceId: "probe-device" },
        collectedAt: new Date().toISOString(),
        source: "probe",
        previousCursor: null,
        weblite: { html: "", bootstrap: {}, conversations },
        messagesByConversationId: {}
      });
      const conversationSources = conversations.map((conversation) => ({
        cidHash: hash(firstString(conversation, [["cid"]])),
        customerSource: firstPath(conversation, CUSTOMER_ID_PATHS)?.join(".") || null,
        customerHash: hash(firstString(conversation, CUSTOMER_ID_PATHS)),
        nameSource: firstPath(conversation, CUSTOMER_NAME_PATHS)?.join(".") || null,
        nameHash: hash(firstString(conversation, CUSTOMER_NAME_PATHS))
      }));
      printJson({
        ok: page.ok === true,
        pageCount: conversations.length,
        pageDistinctCustomerIds: distinctCount(conversationSources.map((item) => item.customerHash)),
        pageDistinctNames: distinctCount(conversationSources.map((item) => item.nameHash)),
        mappedCustomers: batch.customers?.length || 0,
        mappedConversations: batch.conversations?.length || 0,
        mappedDistinctCustomerIds: distinctCount((batch.customers || []).map((item) => hash(item.externalCustomerId))),
        mappedDistinctNames: distinctCount((batch.customers || []).map((item) => hash(item.displayName))),
        customerSources: countBy(conversationSources.map((item) => item.customerSource || "none")),
        nameSources: countBy(conversationSources.map((item) => item.nameSource || "none")),
        conversationSources,
        leaks: {
          chatToken: JSON.stringify(batch).includes("chatToken"),
          kHTAccessToken: JSON.stringify(batch).includes("kHTAccessToken"),
          rawMessageContentKey: JSON.stringify(batch).includes('"content"')
        }
      });
    }
  }
} catch (error) {
  printJson({ ok: false, error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

function executeChromeJavascript(source) {
  const jsPath = join(tmp, `${Date.now()}-${Math.random().toString(16).slice(2)}.js`);
  writeFileSync(jsPath, source);
  const appleScript = `
set jsCode to read POSIX file "${escapeAppleString(jsPath)}" as «class utf8»
tell application "Google Chrome"
  repeat with chromeWindow in windows
    repeat with chromeTab in tabs of chromeWindow
      set tabUrl to URL of chromeTab
      if tabUrl starts with "https://onetalk.alibaba.com/" then
        return execute chromeTab javascript jsCode
      end if
    end repeat
  end repeat
end tell
return "{\\"ok\\":false,\\"error\\":\\"onetalk_tab_not_found\\"}"
`;
  return execFileSync("osascript", ["-e", appleScript], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function buildStartProbeJavascript(input) {
  return `
(() => {
  const probeId = ${JSON.stringify(input.probeId)};
  const state = { done: false, result: "" };
  window[probeId] = state;
  const finish = (result) => {
    state.done = true;
    state.result = JSON.stringify(result);
  };
  const timeout = window.setTimeout(() => finish({ ok: false, error: "page_bridge_timeout" }), ${Number(input.timeoutMs)});
  function onMessage(event) {
    if (event.source !== window || !event.data || typeof event.data !== "object") return;
    if (event.data.source !== "tradebridge-onetalk-page") return;
    if (event.data.type !== "get-onetalk-conversations-result" || event.data.requestId !== probeId) return;
    window.clearTimeout(timeout);
    window.removeEventListener("message", onMessage);
    finish({
      ok: event.data.ok === true,
      error: typeof event.data.error === "string" ? event.data.error : undefined,
      conversations: Array.isArray(event.data.conversations) ? event.data.conversations : []
    });
  }
  window.addEventListener("message", onMessage);
  window.postMessage({
    source: "tradebridge-extension",
    type: "get-onetalk-conversations",
    requestId: probeId,
    cursor: Date.now(),
    count: 20
  }, window.location.origin);
  return "started";
})()
`;
}

function buildPollJavascript(probeId) {
  return `
(() => {
  const state = window[${JSON.stringify(probeId)}];
  if (!state || !state.done) return "";
  const result = state.result || "";
  try { delete window[${JSON.stringify(probeId)}]; } catch {}
  return result;
})()
`;
}

function firstPath(source, paths) {
  return paths.find((path) => {
    const value = valueAtPath(source, path);
    return (typeof value === "string" && value.trim()) || (typeof value === "number" && Number.isFinite(value));
  });
}

function firstString(source, paths) {
  const path = firstPath(source, paths);
  if (!path) return "";
  const value = valueAtPath(source, path);
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function valueAtPath(source, path) {
  let current = source;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function distinctCount(values) {
  return new Set(values.filter(Boolean)).size;
}

function countBy(values) {
  return values.reduce((output, value) => {
    output[value] = (output[value] || 0) + 1;
    return output;
  }, {});
}

function hash(value) {
  if (!value) return null;
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const [key, inlineValue] = item.slice(2).split("=", 2);
    output[key] = inlineValue ?? argv[index + 1] ?? "";
    if (inlineValue === undefined) index += 1;
  }
  return output;
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function escapeAppleString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
