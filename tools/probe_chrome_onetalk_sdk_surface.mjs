#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = parseArgs(process.argv.slice(2));
const timeoutMs = Number(args.timeoutMs || args.timeout || 30_000);
const probeId = `tradebridgeSdkSurfaceProbe_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const tmp = mkdtempSync(join(tmpdir(), "tradebridge-onetalk-sdk-surface-"));

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
    state.result = JSON.stringify(result, null, 2);
  };
  const timeout = window.setTimeout(() => finish({ ok: false, error: "page_runtime_probe_timeout" }), ${Number(input.timeoutMs)});
  function onMessage(event) {
    if (event.source !== window || !event.data || event.data.source !== "tradebridge-sdk-surface-probe") return;
    if (event.data.probeId !== probeId) return;
    window.clearTimeout(timeout);
    window.removeEventListener("message", onMessage);
    finish(event.data.result);
  }
  window.addEventListener("message", onMessage);
  const script = document.createElement("script");
  script.textContent = ${JSON.stringify(buildPageRuntimeJavascript())}.replace(/__PROBE_ID__/g, probeId);
  (document.documentElement || document.head).append(script);
  script.remove();
  return "started";
})()
`;
}

function buildPageRuntimeJavascript() {
  return `
(() => {
  const probeId = "__PROBE_ID__";
  const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  const ownKeys = (value) => isRecord(value) || typeof value === "function" ? Object.getOwnPropertyNames(value).sort() : [];
  const protoKeys = (value) => {
    if (!value) return [];
    const proto = Object.getPrototypeOf(value);
    return proto ? Object.getOwnPropertyNames(proto).filter((key) => key !== "constructor").sort() : [];
  };
  const describeObject = (value) => {
    const names = Array.from(new Set([...ownKeys(value), ...protoKeys(value)])).sort();
    return {
      type: value === null ? "null" : typeof value,
      keys: names.slice(0, 120),
      functionKeys: names.filter((key) => typeof value?.[key] === "function").slice(0, 120)
    };
  };
  const methodHints = (service, names) => Object.fromEntries(names.map((name) => {
    const fn = service?.[name];
    if (typeof fn !== "function") return [name, { available: false }];
    const source = Function.prototype.toString.call(fn);
    const signature = source.slice(0, Math.min(source.indexOf("{") > 0 ? source.indexOf("{") : 160, 160));
    const routeMatches = Array.from(new Set(source.match(/\\/r\\/[A-Za-z0-9!_/-]+/g) || [])).sort();
    const paramProps = Array.from(new Set(Array.from(source.matchAll(/\\b[et]\\.([A-Za-z_$][\\w$]*)/g)).map((match) => match[1]))).sort();
    const keywordMatches = [
      "listUserMessages",
      "listNewestPagination",
      "nextCursor",
      "cursor",
      "pageSize",
      "count",
      "cid",
      "conversationCode",
      "fetchMessagesWithoutUpdateToRead",
      "searchRemoteHistoryMessage"
    ].filter((keyword) => source.includes(keyword));
    const sourceContexts = Object.fromEntries(["timeStamp", "Object(p.a)", "listMessageWithConversationCode", "fetchMessagesWithoutUpdateToRead"].flatMap((keyword) => {
      const index = source.indexOf(keyword);
      if (index < 0) return [];
      const start = Math.max(0, index - 120);
      const end = Math.min(source.length, index + keyword.length + 160);
      return [[keyword, source.slice(start, end)]];
    }));
    return [name, {
      available: true,
      arity: fn.length,
      sourceLength: source.length,
      signature,
      routeMatches,
      paramProps,
      keywordMatches,
      sourceContexts
    }];
  }));
  const callFactory = (source, key) => {
    try {
      if (typeof source?.[key] !== "function") return { available: false };
      const value = source[key]();
      return { available: true, description: describeObject(value) };
    } catch (error) {
      return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
  const sdkDefault = window.IcbuIM?.IMBaaSSDK?.default;
  const sdkKeys = describeObject(sdkDefault);
  const factoryNames = sdkKeys.functionKeys.filter((key) => /^get.*Service(?:V2|Http)?$/.test(key)).slice(0, 40);
  const services = Object.fromEntries(factoryNames.map((key) => [key, callFactory(sdkDefault, key)]));
  const messageService = typeof sdkDefault?.getMessageService === "function" ? sdkDefault.getMessageService() : null;
  const messageServiceV2 = typeof sdkDefault?.getMessageServiceV2 === "function" ? sdkDefault.getMessageServiceV2() : null;
  const conversationService = typeof sdkDefault?.getConversationService === "function" ? sdkDefault.getConversationService() : null;
  const conversationServiceV2 = typeof sdkDefault?.getConversationServiceV2 === "function" ? sdkDefault.getConversationServiceV2() : null;
  window.postMessage({
    source: "tradebridge-sdk-surface-probe",
    probeId,
    result: {
      ok: true,
      hasIcbuIM: !!window.IcbuIM,
      icbuIMKeys: ownKeys(window.IcbuIM).slice(0, 80),
      hasSdkDefault: !!sdkDefault,
      sdkDefault: sdkKeys,
      services,
      methodHints: {
        messageService: methodHints(messageService, [
          "fetchMessages",
          "fetchMessagesWithoutUpdateToRead",
          "searchHistoryMessage",
          "searchRemoteHistoryMessage",
          "searchRemoteMessage",
          "sendUIMessages",
          "sendTextMessage"
        ]),
        messageServiceV2: methodHints(messageServiceV2, [
          "listMessageWithConversationCode",
          "listMessageWithConversationCodeForHistory",
          "fetchMessages",
          "fetchMessagesWithoutUpdateToRead"
        ]),
        conversationService: methodHints(conversationService, [
          "getConversationList",
          "getConversationListByPagination",
          "getConversation",
          "getConversationContactDetailList"
        ]),
        conversationServiceV2: methodHints(conversationServiceV2, [
          "listConversationPagination",
          "getConversationListByPagination",
          "listNewestPagination"
        ])
      }
    }
  }, window.location.origin);
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
