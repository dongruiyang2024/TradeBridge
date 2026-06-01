#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = parseArgs(process.argv.slice(2));
const timeoutMs = Number(args.timeoutMs || args.timeout || 20_000);
const probeId = `tradebridgeConversationBridgeProbe_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const tmp = mkdtempSync(join(tmpdir(), "tradebridge-onetalk-conversation-bridge-"));

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
      console.log(output);
      process.exitCode = JSON.parse(output).ok === false ? 1 : 0;
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
set jsCode to read (POSIX file "${escapeAppleString(jsPath)}")
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
    state.result = JSON.stringify(result, null, 2);
  };
  const timeout = window.setTimeout(() => finish({ ok: false, error: "page_bridge_timeout" }), ${Number(input.timeoutMs)});
  const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  const keys = (value) => (isRecord(value) ? Object.keys(value).sort() : []);
  const hasOwnString = (value, key) => isRecord(value) && typeof value[key] === "string" && value[key].trim().length > 0;
  const valueAtPath = (source, path) => {
    let current = source;
    for (const key of path) {
      if (!isRecord(current)) return undefined;
      current = current[key];
    }
    return current;
  };
  const firstString = (source, paths) => {
    for (const path of paths) {
      const value = valueAtPath(source, path);
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
    return "";
  };
  const distinctCount = (values) => new Set(values.filter(Boolean)).size;
  const customerName = (conversation) =>
    firstString(conversation, [["contact", "name"], ["latestMessage", "message", "contact", "name"], ["name"]]);
  const customerId = (conversation) =>
    firstString(conversation, [
      ["contact", "accountIdEncrypt"],
      ["contact", "accountId"],
      ["contact", "aliIdEncrypt"],
      ["contact", "aliId"],
      ["latestMessage", "message", "contact", "accountIdEncrypt"],
      ["latestMessage", "message", "contact", "accountId"],
      ["latestMessage", "message", "contact", "aliIdEncrypt"],
      ["accountIdEncrypt"],
      ["accountId"],
      ["aliIdEncrypt"]
    ]);
  function onMessage(event) {
    if (event.source !== window || !isRecord(event.data)) return;
    if (event.data.source !== "tradebridge-onetalk-page") return;
    if (event.data.type !== "get-onetalk-conversations-result" || event.data.requestId !== probeId) return;
    window.clearTimeout(timeout);
    window.removeEventListener("message", onMessage);
    const conversations = Array.isArray(event.data.conversations) ? event.data.conversations.filter(isRecord) : [];
    const serialized = JSON.stringify(event.data);
    finish({
      ok: event.data.ok === true,
      error: typeof event.data.error === "string" ? event.data.error : undefined,
      count: conversations.length,
      hasMore: event.data.hasMore === true,
      nextCursorType: event.data.nextCursor == null ? null : typeof event.data.nextCursor,
      withCid: conversations.filter((item) => hasOwnString(item, "cid")).length,
      withAccountId: conversations.filter((item) =>
        hasOwnString(item, "accountId") ||
        hasOwnString(item, "accountIdEncrypt") ||
        hasOwnString(item.contact, "accountId") ||
        hasOwnString(item.contact, "accountIdEncrypt")
      ).length,
      withCustomerNameField: conversations.filter((item) =>
        !!customerName(item)
      ).length,
      distinctCustomerNameCount: distinctCount(conversations.map(customerName)),
      distinctCustomerIdCount: distinctCount(conversations.map(customerId)),
      sampleKeys: keys(conversations[0]),
      sampleContactKeys: keys(conversations[0]?.contact),
      sampleLatestMessageKeys: keys(conversations[0]?.latestMessage),
      leaks: {
        chatToken: serialized.includes("chatToken"),
        kHTAccessToken: serialized.includes("kHTAccessToken"),
        rawMessageContentKey: serialized.includes('"content"')
      }
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
