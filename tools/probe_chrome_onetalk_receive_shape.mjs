#!/usr/bin/env node
// Probe: capture the SHAPE of the SDK's incoming-message callback (Plan B+).
//
// The SDK callback probe showed getMessageService()/V2 expose notifyReceiveMsg
// and a delegateList — a delegate/observer pattern the page uses to render
// incoming messages. This is the reliable interception point (the socket does
// NOT carry plaintext messages).
//
// Before building extraction we must know the real argument shape. This probe:
//   1. Wraps notifyReceiveMsg (pass-through) on the message service prototype,
//      recording the ARGUMENT key paths (names only) when a real message fires.
//   2. Inspects delegateList entries: count, constructor names, method names —
//      to learn the delegate interface we could register into instead.
//
// Requires a REAL inbound message during the window: have ANOTHER account
// message this seller. Records key names only — never message text, cid, or
// tokens. The wrapper is pass-through, so the page keeps working.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = parseArgs(process.argv.slice(2));
const observeMs = Number(args.observeMs || args.observe || 60_000);
const timeoutMs = observeMs + 8_000;
const probeId = `tradebridgeReceiveShapeProbe_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const tmp = mkdtempSync(join(tmpdir(), "tradebridge-onetalk-receive-shape-"));

try {
  const startResult = executeChromeJavascript(buildStartProbeJavascript({ probeId, observeMs }));
  if (startResult !== "started" && startResult !== "already") {
    printJson({ ok: false, error: "probe_start_failed", startResult });
    process.exitCode = 1;
  } else {
    const deadline = Date.now() + timeoutMs;
    let output = "";
    while (Date.now() < deadline) {
      output = executeChromeJavascript(buildPollJavascript(probeId));
      if (output) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
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
  const timeout = window.setTimeout(() => finish({ ok: false, error: "page_runtime_probe_timeout" }), ${Number(input.observeMs) + 4000});
  function onMessage(event) {
    if (event.source !== window || !event.data || event.data.source !== "tradebridge-receive-shape-probe") return;
    if (event.data.probeId !== probeId) return;
    window.clearTimeout(timeout);
    window.removeEventListener("message", onMessage);
    finish(event.data.result);
  }
  window.addEventListener("message", onMessage);
  const script = document.createElement("script");
  script.textContent = ${JSON.stringify(buildPageRuntimeJavascript())}
    .replace(/__PROBE_ID__/g, probeId)
    .replace(/__OBSERVE_MS__/g, String(${Number(input.observeMs)}));
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
  const observeMs = __OBSERVE_MS__;
  const isRecord = (v) => !!v && typeof v === "object" && !Array.isArray(v);

  // Recursive key paths (names only, never values), bounded depth/breadth.
  const keyPaths = (value, prefix, depth, out) => {
    if (depth < 0 || out.size > 200) return;
    if (Array.isArray(value)) { if (value.length) keyPaths(value[0], prefix + "[]", depth - 1, out); return; }
    if (!isRecord(value)) return;
    for (const k of Object.keys(value)) {
      const path = prefix ? prefix + "." + k : k;
      out.add(path);
      keyPaths(value[k], path, depth - 1, out);
    }
  };

  const sdk = window.IcbuIM && window.IcbuIM.IMBaaSSDK && window.IcbuIM.IMBaaSSDK.default;
  if (!sdk) { post({ ok: false, error: "sdk_default_unavailable" }); return; }

  const svc = typeof sdk.getMessageServiceV2 === "function" ? sdk.getMessageServiceV2()
            : typeof sdk.getMessageService === "function" ? sdk.getMessageService() : null;
  if (!svc) { post({ ok: false, error: "message_service_unavailable" }); return; }

  // --- 1) Inspect delegateList interface (names only) ---
  const delegateInfo = (() => {
    try {
      const list = svc.delegateList;
      if (!Array.isArray(list)) return { isArray: false, type: typeof list };
      return {
        isArray: true,
        count: list.length,
        entries: list.slice(0, 8).map((d) => ({
          ctor: (d && d.constructor && d.constructor.name) || typeof d,
          methods: d ? Array.from(new Set([
            ...Object.getOwnPropertyNames(d),
            ...(Object.getPrototypeOf(d) ? Object.getOwnPropertyNames(Object.getPrototypeOf(d)) : [])
          ])).filter((k) => { try { return typeof d[k] === "function" && k !== "constructor"; } catch { return false; } }).slice(0, 40) : []
        }))
      };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })();

  // --- 2) Wrap notifyReceiveMsg (pass-through) to capture arg shape ---
  const captures = [];
  let wrapped = false;
  const wrapOn = (target, label) => {
    try {
      if (!target || typeof target.notifyReceiveMsg !== "function" || target.__tbReceiveWrapped) return;
      const original = target.notifyReceiveMsg;
      target.notifyReceiveMsg = function (...args) {
        try {
          if (captures.length < 5) {
            captures.push({
              source: label,
              argCount: args.length,
              argTypes: args.map((a) => Array.isArray(a) ? "array(" + a.length + ")" : (a === null ? "null" : typeof a)),
              argKeyPaths: args.map((a) => { const s = new Set(); keyPaths(a, "", 5, s); return Array.from(s).sort().slice(0, 120); })
            });
          }
        } catch {}
        return original.apply(this, args);
      };
      target.__tbReceiveWrapped = true;
      wrapped = true;
    } catch {}
  };
  // Wrap on the instance and on its prototype (the page may hold a different instance).
  wrapOn(svc, "instance");
  const proto = Object.getPrototypeOf(svc);
  wrapOn(proto, "prototype");
  // Also try the inner messageService delegate if present (V2 wraps it).
  if (svc.messageService) { wrapOn(svc.messageService, "inner"); const ip = Object.getPrototypeOf(svc.messageService); wrapOn(ip, "inner-prototype"); }

  window.setTimeout(() => {
    post({
      ok: true,
      note: "notifyReceiveMsg wrapped pass-through; arg key NAMES only. Needs a REAL inbound message during the window (have another account message this seller).",
      observedMs,
      wrapped,
      delegateInfo,
      captureCount: captures.length,
      captures
    });
  }, observeMs);

  function post(result) {
    window.postMessage({ source: "tradebridge-receive-shape-probe", probeId, result }, window.location.origin);
  }
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
