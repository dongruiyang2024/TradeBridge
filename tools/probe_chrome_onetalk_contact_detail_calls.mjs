#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const timeoutMs = Number(process.argv.find((item) => item.startsWith("--timeoutMs="))?.split("=")[1] || 45_000);
const probeId = `tradebridgeContactDetailCallProbe_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const tmp = mkdtempSync(join(tmpdir(), "tradebridge-onetalk-contact-detail-calls-"));

try {
  const started = executeChromeJavascript(buildStartJavascript());
  if (started !== "started") {
    printJson({ ok: false, error: "probe_start_failed", started });
    process.exitCode = 1;
  } else {
    const deadline = Date.now() + timeoutMs;
    let output = "";
    while (Date.now() < deadline) {
      output = executeChromeJavascript(buildPollJavascript());
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
  return execFileSync("osascript", ["-e", buildAppleScript(jsPath)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function buildStartJavascript() {
  return `
(() => {
  const probeId = ${JSON.stringify(probeId)};
  const state = { done: false, result: "" };
  window[probeId] = state;
  const finish = (result) => {
    state.done = true;
    state.result = JSON.stringify(result, null, 2);
  };
  const timeout = window.setTimeout(() => finish({ ok: false, error: "page_runtime_probe_timeout" }), ${timeoutMs});
  function onMessage(event) {
    if (event.source !== window || !event.data || event.data.source !== "tradebridge-contact-detail-call-probe") return;
    if (event.data.probeId !== probeId) return;
    window.clearTimeout(timeout);
    window.removeEventListener("message", onMessage);
    finish(event.data.result);
  }
  window.addEventListener("message", onMessage);
  const script = document.createElement("script");
  script.textContent = ${JSON.stringify(buildPageJavascript())}.replace(/__PROBE_ID__/g, probeId);
  (document.documentElement || document.head).append(script);
  script.remove();
  return "started";
})()
`;
}

function buildPageJavascript() {
  return `
(() => {
  const probeId = "__PROBE_ID__";
  const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  const keys = (value) => (isRecord(value) ? Object.keys(value).sort() : []);
  const firstString = (source, paths) => {
    for (const path of paths) {
      let current = source;
      for (const key of path.split(".")) {
        if (!isRecord(current)) {
          current = undefined;
          break;
        }
        current = current[key];
      }
      if (typeof current === "string" && current.trim()) return current.trim();
      if (typeof current === "number" && Number.isFinite(current)) return String(current);
    }
  };
  const compact = (source) => Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  const withTimeout = (label, promise, ms = 15_000) => Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + "_timeout")), ms))
  ]);
  const listFromConversationResponse = (value) => {
    if (Array.isArray(value?.list)) return value.list.filter(isRecord);
    if (Array.isArray(value?.data?.list)) return value.data.list.filter(isRecord);
    if (Array.isArray(value?.result?.list)) return value.result.list.filter(isRecord);
    return [];
  };
  const nameKey = /^(displayName|buyerName|customerName|memberName|contactName|firstName|lastName|companyName|company|nickName|nickname|fullName|name|loginId|avatar|portrait|headImg|headImage|logo)$/i;
  const sensitiveKey = /(token|cookie|sign|password|secret|authorization|chatToken|csrf|sid|uid|device|did)/i;
  const collectNamePaths = (value, path = "", output = [], depth = 0) => {
    if (depth > 8 || output.length >= 200) return output;
    if (Array.isArray(value)) {
      for (let index = 0; index < Math.min(value.length, 3); index += 1) collectNamePaths(value[index], path + "[]", output, depth + 1);
      return output;
    }
    if (!isRecord(value)) return output;
    for (const [key, child] of Object.entries(value)) {
      if (sensitiveKey.test(key)) continue;
      const nextPath = path ? path + "." + key : key;
      if (nameKey.test(key) && child !== null && child !== undefined && String(child).length > 0 && typeof child !== "object") {
        output.push(nextPath.replace(/\\[\\]\\[\\]/g, "[]"));
      }
      collectNamePaths(child, nextPath, output, depth + 1);
    }
    return output;
  };
  const collectFieldPathStats = (items, matcher) => {
    const stats = new Map();
    const visit = (value, path, depth) => {
      if (depth > 8) return;
      if (Array.isArray(value)) {
        for (let index = 0; index < Math.min(value.length, 3); index += 1) visit(value[index], path + "[]", depth + 1);
        return;
      }
      if (!isRecord(value)) return;
      for (const [key, child] of Object.entries(value)) {
        const nextPath = path ? path + "." + key : key;
        if (matcher.test(key) && child !== null && child !== undefined && typeof child !== "object") {
          const normalized = nextPath.replace(/\\[\\]\\[\\]/g, "[]");
          const current = stats.get(normalized) || {
            path: normalized,
            type: typeof child,
            valueCount: 0,
            minLength: null,
            maxLength: null
          };
          current.valueCount += String(child).length > 0 ? 1 : 0;
          const length = String(child).length;
          current.minLength = current.minLength === null ? length : Math.min(current.minLength, length);
          current.maxLength = current.maxLength === null ? length : Math.max(current.maxLength, length);
          stats.set(normalized, current);
        }
        visit(child, nextPath, depth + 1);
      }
    };
    for (const item of items) visit(item, "", 0);
    return Array.from(stats.values()).sort((a, b) => b.valueCount - a.valueCount || a.path.localeCompare(b.path));
  };
  const summarize = (value) => {
    const list = Array.isArray(value) ? value : Array.isArray(value?.contactDetailList) ? value.contactDetailList : [];
    const namePaths = collectNamePaths(value);
    const counts = Object.fromEntries(Array.from(new Set(namePaths)).sort().map((path) => [path, namePaths.filter((item) => item === path).length]));
    return {
      type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
      topKeys: keys(value),
      listLength: list.length,
      sampleKeys: keys(list.find(isRecord)),
      namePathCounts: counts,
      hasAnyNameLikeValue: namePaths.length > 0
    };
  };
  const request = async (label, service, entries) => {
    try {
      if (!service || typeof service.getConversationContactDetailList !== "function") {
        return { label, ok: false, error: "method_unavailable" };
      }
      const value = await withTimeout(label, service.getConversationContactDetailList(entries));
      return { label, ok: true, entryCount: entries.length, summary: summarize(value) };
    } catch (error) {
      return { label, ok: false, entryCount: entries.length, error: error instanceof Error ? error.message : String(error) };
    }
  };

  (async () => {
    const sdk = window.IcbuIM?.IMBaaSSDK?.default;
    const conversationService = sdk?.getConversationService?.();
    const conversationServiceHttp = sdk?.getConversationServiceHttp?.();
    const conversationServiceV2 = sdk?.getConversationServiceV2?.();
    const result = {
      ok: false,
      hasSdk: !!sdk,
      hasChatTokenInUrl: new URL(location.href).searchParams.has("chatToken"),
      conversationCount: 0,
      candidateShape: {},
      calls: []
    };
    if (!sdk) throw new Error("sdk_unavailable");
    const conversationResponse = await withTimeout("conversation-list", conversationServiceV2.getConversationListByPagination({
      cursor: Date.now(),
      count: 20
    }));
    const conversations = listFromConversationResponse(conversationResponse);
    result.conversationCount = conversations.length;
    result.conversationFieldPaths = {
      tokenLike: collectFieldPathStats(conversations, /(chatToken|kHTAccessToken|accessToken|token)$/i).slice(0, 80),
      idLike: collectFieldPathStats(conversations, /(accountIdEncrypt|aliIdEncrypt|encryptAccountId|encryptAliId|loginId|loginIdEncrypt)$/i).slice(0, 80),
      nameLike: collectFieldPathStats(conversations, /^(name|displayName|companyName|nickName|fullName)$/i).slice(0, 80)
    };
    const chatToken = new URL(location.href).searchParams.get("chatToken") || "";
    const accountEntries = [];
    const aliEntries = [];
    const contactAccountEntries = [];
    const contactAliEntries = [];
    for (const conversation of conversations) {
      const accountId = firstString(conversation, ["accountIdEncrypt", "encryptAccountId"]);
      const aliId = firstString(conversation, ["aliIdEncrypt", "encryptAliId"]);
      const contactAccountId = firstString(conversation, ["contact.accountIdEncrypt", "contact.encryptAccountId"]);
      const contactAliId = firstString(conversation, ["contact.aliIdEncrypt", "contact.encryptAliId"]);
      if (accountId && !accountEntries.some((item) => item.encryptAccountId === accountId)) accountEntries.push({ encryptAccountId: accountId });
      if (aliId && !aliEntries.some((item) => item.encryptAliId === aliId)) aliEntries.push({ encryptAliId: aliId });
      if (contactAccountId && !contactAccountEntries.some((item) => item.encryptAccountId === contactAccountId)) contactAccountEntries.push({ encryptAccountId: contactAccountId });
      if (contactAliId && !contactAliEntries.some((item) => item.encryptAliId === contactAliId)) contactAliEntries.push({ encryptAliId: contactAliId });
    }
    const withChatToken = (entries) => entries.map((entry) => compact({ ...entry, chatToken }));
    result.candidateShape = {
      accountEntries: accountEntries.length,
      aliEntries: aliEntries.length,
      contactAccountEntries: contactAccountEntries.length,
      contactAliEntries: contactAliEntries.length,
      entriesWithChatTokenHaveToken: !!chatToken
    };
    const cases = [
      ["http-account", conversationServiceHttp, accountEntries],
      ["http-account-chat-token", conversationServiceHttp, withChatToken(accountEntries)],
      ["http-ali", conversationServiceHttp, aliEntries],
      ["http-ali-chat-token", conversationServiceHttp, withChatToken(aliEntries)],
      ["http-contact-account", conversationServiceHttp, contactAccountEntries],
      ["http-contact-ali", conversationServiceHttp, contactAliEntries],
      ["service-account", conversationService, accountEntries],
      ["service-account-chat-token", conversationService, withChatToken(accountEntries)],
      ["v2-account", conversationServiceV2, accountEntries],
      ["v2-account-chat-token", conversationServiceV2, withChatToken(accountEntries)]
    ];
    for (const [label, service, entries] of cases) {
      if (!entries.length) {
        result.calls.push({ label, ok: false, entryCount: 0, error: "no_entries" });
        continue;
      }
      result.calls.push(await request(label, service, entries.slice(0, 10)));
    }
    result.ok = true;
    window.postMessage({ source: "tradebridge-contact-detail-call-probe", probeId, result }, window.location.origin);
  })().catch((error) => {
    window.postMessage({
      source: "tradebridge-contact-detail-call-probe",
      probeId,
      result: { ok: false, error: error instanceof Error ? error.message : String(error) }
    }, window.location.origin);
  });
})()
`;
}

function buildPollJavascript() {
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

function buildAppleScript(jsPath) {
  return `
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
}

function escapeAppleString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}
