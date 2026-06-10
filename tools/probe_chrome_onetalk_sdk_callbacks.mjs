#!/usr/bin/env node
// Probe: map the OneTalk page SDK's message-callback surface (Plan B).
//
// If realtime messages do NOT flow as plaintext over the socket, the next best
// interception point is the SDK layer the page itself uses to render incoming
// messages: getMessageService()/getMessageServiceV2() and whatever
// listener/callback registration they expose. The page MUST hand received
// messages to some JS callback to draw them — that callback is more reliable
// than the socket.
//
// This probe ONLY inspects shape: it enumerates methods on the message
// services, flags names that look like listener/callback registration, and
// records the SDK default's own keys (to spot internal emitters/stores). It
// does NOT invoke side-effecting methods and never prints values, tokens, or
// message text — method names, arities, and key names only.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = parseArgs(process.argv.slice(2));
const timeoutMs = Number(args.timeoutMs || args.timeout || 20_000);
const probeId = `tradebridgeSdkCallbackProbe_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const tmp = mkdtempSync(join(tmpdir(), "tradebridge-onetalk-sdk-callbacks-"));

try {
  const startResult = executeChromeJavascript(buildStartProbeJavascript({ probeId, timeoutMs }));
  if (startResult !== "started" && startResult !== "already") {
    printJson({ ok: false, error: "probe_start_failed", startResult });
    process.exitCode = 1;
  } else {
    const deadline = Date.now() + timeoutMs;
    let output = "";
    while (Date.now() < deadline) {
      output = executeChromeJavascript(buildPollJavascript(probeId));
      if (output) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
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
  if (window[probeId]) return "already";
  const state = { done: false, result: "" };
  window[probeId] = state;
  const finish = (result) => { state.done = true; state.result = JSON.stringify(result, null, 2); };
  const timeout = window.setTimeout(() => finish({ ok: false, error: "page_runtime_probe_timeout" }), ${Number(input.timeoutMs)});
  function onMessage(event) {
    if (event.source !== window || !event.data || event.data.source !== "tradebridge-sdk-callback-probe") return;
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
  const isRecord = (v) => !!v && typeof v === "object" && !Array.isArray(v);

  const ownKeys = (v) => (isRecord(v) || typeof v === "function") ? Object.getOwnPropertyNames(v) : [];
  const protoKeys = (v) => {
    if (!v) return [];
    const p = Object.getPrototypeOf(v);
    return p ? Object.getOwnPropertyNames(p).filter((k) => k !== "constructor") : [];
  };
  const allKeys = (v) => Array.from(new Set([...ownKeys(v), ...protoKeys(v)])).sort();
  const methodNames = (v) => allKeys(v).filter((k) => { try { return typeof v[k] === "function"; } catch { return false; } });

  // Names that suggest a place to hook incoming messages.
  const LISTENER_RE = /(add|register|on|set|subscribe|bind).*(listener|callback|message|msg|push|receive|recv|event|handler|observer|notify|sync)/i;
  const MSG_RE = /(message|msg|push|receive|recv|sync|notify|listen|subscribe|observer|dispatch|emit|handler|callback)/i;

  const describe = (label, svc) => {
    if (!svc) return { label, available: false };
    const methods = methodNames(svc);
    return {
      label,
      available: true,
      methodCount: methods.length,
      listenerLikeMethods: methods.filter((m) => LISTENER_RE.test(m)).slice(0, 60),
      messageRelatedMethods: methods.filter((m) => MSG_RE.test(m)).slice(0, 80),
      // Non-function own keys that might be internal emitters/stores/listener arrays.
      dataKeys: ownKeys(svc).filter((k) => { try { return typeof svc[k] !== "function"; } catch { return false; } }).slice(0, 80)
    };
  };

  const sdk = window.IcbuIM && window.IcbuIM.IMBaaSSDK && window.IcbuIM.IMBaaSSDK.default;
  if (!sdk) {
    window.postMessage({ source: "tradebridge-sdk-callback-probe", probeId, result: { ok: false, error: "sdk_default_unavailable", hasIcbuIM: !!window.IcbuIM } }, window.location.origin);
    return;
  }

  const sdkFactoryNames = methodNames(sdk).filter((k) => /^get.*Service(V2|Http)?$/.test(k));
  const callFactory = (name) => { try { return typeof sdk[name] === "function" ? sdk[name]() : null; } catch { return null; } };

  const services = {};
  for (const name of ["getMessageService", "getMessageServiceV2", "getConversationService", "getConversationServiceV2"]) {
    services[name] = describe(name, callFactory(name));
  }

  // The SDK default itself may hold the global message dispatcher / listener registry.
  const sdkSurface = {
    methodCount: methodNames(sdk).length,
    listenerLikeMethods: methodNames(sdk).filter((m) => LISTENER_RE.test(m)).slice(0, 60),
    messageRelatedMethods: methodNames(sdk).filter((m) => MSG_RE.test(m)).slice(0, 80),
    factoryNames: sdkFactoryNames.slice(0, 60),
    dataKeys: ownKeys(sdk).filter((k) => { try { return typeof sdk[k] !== "function"; } catch { return false; } }).slice(0, 80)
  };

  window.postMessage({
    source: "tradebridge-sdk-callback-probe",
    probeId,
    result: {
      ok: true,
      note: "Method/key NAMES only — no values, tokens, or message text. listenerLikeMethods are candidate hook points for intercepting incoming messages at the SDK layer.",
      hasIcbuIM: !!window.IcbuIM,
      sdkDefault: sdkSurface,
      services
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
