#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "tradebridge-onetalk-contact-source-"));
const timeoutMs = Number(process.argv.find((item) => item.startsWith("--timeoutMs="))?.split("=")[1] || 30_000);
const probeId = `tradebridgeContactSourceProbe_${Date.now()}_${Math.random().toString(16).slice(2)}`;

try {
  const start = executeChromeJavascript(buildStartJavascript());
  if (start !== "started") {
    console.log(JSON.stringify({ ok: false, error: "probe_start_failed", start }, null, 2));
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
      console.log(JSON.stringify({ ok: false, error: "probe_timeout" }, null, 2));
      process.exitCode = 1;
    } else {
      console.log(output);
      process.exitCode = JSON.parse(output).ok === false ? 1 : 0;
    }
  }
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
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
    if (event.source !== window || !event.data || event.data.source !== "tradebridge-contact-source-probe") return;
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
  const sdk = window.IcbuIM?.IMBaaSSDK?.default;
  const serviceFactories = {
    conversationService: () => sdk?.getConversationService?.(),
    conversationServiceHttp: () => sdk?.getConversationServiceHttp?.(),
    conversationServiceV2: () => sdk?.getConversationServiceV2?.(),
    contactService: () => sdk?.getContactService?.()
  };
  const keywords = [
    "getConversationContactDetailList",
    "listRecentConversationContactDetail",
    "contactEncryptAliIdList",
    "contactEncryptAccountIdList",
    "chatTokens",
    "chatToken",
    "contactAccountIdEncrypt",
    "accountIdEncrypt",
    "aliIdEncrypt",
    "forEach",
    "map",
    "requestWrapperHttp",
    "requestHelper"
  ];
  const hint = (fn) => {
    if (typeof fn !== "function") return { available: false };
    const source = Function.prototype.toString.call(fn);
    const contexts = {};
    for (const keyword of keywords) {
      const index = source.indexOf(keyword);
      if (index < 0) continue;
      contexts[keyword] = source.slice(Math.max(0, index - 220), Math.min(source.length, index + keyword.length + 320));
    }
    const propMatches = Array.from(new Set(
      Array.from(source.matchAll(/\\b[etnrioas]\\.([A-Za-z_$][\\w$]*)/g)).map((match) => match[1])
    )).sort();
    const stringMatches = Array.from(new Set(
      Array.from(source.matchAll(/["']([^"']{5,140})["']/g))
        .map((match) => match[1])
        .filter((value) => /contact|account|ali|chat|conversation|message|http|list|customer/i.test(value))
    )).slice(0, 120);
    return {
      available: true,
      arity: fn.length,
      sourceLength: source.length,
      signature: source.slice(0, Math.min(180, source.indexOf("{") > 0 ? source.indexOf("{") : 180)),
      keywords: keywords.filter((keyword) => source.includes(keyword)),
      propMatches,
      stringMatches,
      contexts
    };
  };
  const describeService = (factory) => {
    let service;
    try {
      service = factory();
    } catch (error) {
      return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (!service || typeof service !== "object") return { available: false };
    const keys = Object.getOwnPropertyNames(service).sort();
    return {
      available: true,
      keys,
      getConversationContactDetailList: hint(service.getConversationContactDetailList),
      getConversationListByPagination: hint(service.getConversationListByPagination),
      getConversationList: hint(service.getConversationList),
      listContactDetails: hint(service.listContactDetails),
      getContact: hint(service.getContact),
      listAllContacts: hint(service.listAllContacts),
      mapAllContacts: hint(service.mapAllContacts)
    };
  };
  window.postMessage({
    source: "tradebridge-contact-source-probe",
    probeId,
    result: {
      ok: true,
      hasSdk: !!sdk,
      services: Object.fromEntries(Object.entries(serviceFactories).map(([name, factory]) => [name, describeService(factory)]))
    }
  }, window.location.origin);
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
