#!/usr/bin/env node
// Probe: capture notifyReceiveMsg argument shape on the CONFIRMED live instance.
//
// sdk_scan located the real message receiver the page uses:
//   IcbuIM.IMBaaSSDK.IcbuMessageServiceImpl.instance
// It has notifyReceiveMsg and a non-empty delegateList (delegate exposes
// onMessageSend). This probe wraps notifyReceiveMsg on THAT exact singleton
// (pass-through) and persists captured argument key paths on window, so a real
// inbound message reveals the true shape — no guessing.
//
// Two phases via re-run:
//   run 1: install the wrapper (idempotent), report install status.
//   run 2 (after a real inbound message): report persisted captures.
//
// Records key NAMES / type tags only — never message text, cid, or tokens.
// The wrapper is pass-through; the page keeps working.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = parseArgs(process.argv.slice(2));
const timeoutMs = Number(args.timeoutMs || args.timeout || 15_000);
const probeId = `tradebridgeReceiveCaptureProbe_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const tmp = mkdtempSync(join(tmpdir(), "tradebridge-onetalk-receive-capture-"));

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
    if (event.source !== window || !event.data || event.data.source !== "tradebridge-receive-capture-probe") return;
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
  const STORE = "__tbReceiveCaptureStore";
  const isRecord = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const errOf = (e) => (e && (e.message || e.name)) ? String(e.message || e.name) : String(e);
  const post = (result) => { try { window.postMessage({ source: "tradebridge-receive-capture-probe", probeId, result }, window.location.origin); } catch (e) {} };

  const keyPaths = (value, prefix, depth, out) => {
    if (depth < 0 || out.size > 250) return;
    if (Array.isArray(value)) { if (value.length) keyPaths(value[0], prefix + "[]", depth - 1, out); return; }
    if (!isRecord(value)) return;
    for (const k of Object.keys(value)) {
      const path = prefix ? prefix + "." + k : k;
      out.add(path);
      keyPaths(value[k], path, depth - 1, out);
    }
  };

  // Persistent capture store survives across re-runs of this probe.
  const store = (window[STORE] = window[STORE] || { installed: false, wrappedPath: null, captures: [] });

  try {
    const inst = window.IcbuIM
      && window.IcbuIM.IMBaaSSDK
      && window.IcbuIM.IMBaaSSDK.IcbuMessageServiceImpl
      && window.IcbuIM.IMBaaSSDK.IcbuMessageServiceImpl.instance;
    if (!inst) { post({ ok: false, error: "live_instance_unavailable", note: "IcbuIM.IMBaaSSDK.IcbuMessageServiceImpl.instance not found" }); return "done"; }

    if (!store.installed) {
      if (typeof inst.notifyReceiveMsg !== "function") {
        post({ ok: false, error: "notifyReceiveMsg_missing", instanceFns: Object.getOwnPropertyNames(Object.getPrototypeOf(inst) || {}).slice(0, 40) });
        return "done";
      }
      const original = inst.notifyReceiveMsg;
      inst.notifyReceiveMsg = function (...args) {
        try {
          if (store.captures.length < 8) {
            store.captures.push({
              at: Date.now(),
              argCount: args.length,
              argTypes: args.map((a) => Array.isArray(a) ? "array(" + a.length + ")" : (a === null ? "null" : typeof a)),
              argKeyPaths: args.map((a) => { const s = new Set(); keyPaths(a, "", 6, s); return Array.from(s).sort().slice(0, 160); })
            });
          }
        } catch (e) {}
        return original.apply(this, args);
      };
      store.installed = true;
      store.wrappedPath = "IcbuIM.IMBaaSSDK.IcbuMessageServiceImpl.instance.notifyReceiveMsg";
    }

    post({
      ok: true,
      note: store.captures.length
        ? "Captures present — this is the real notifyReceiveMsg argument shape."
        : "Wrapper installed on confirmed live singleton. Now have a REAL inbound message arrive, then re-run this probe to read captures.",
      installed: store.installed,
      wrappedPath: store.wrappedPath,
      delegateCount: Array.isArray(inst.delegateList) ? inst.delegateList.length : null,
      captureCount: store.captures.length,
      captures: store.captures
    });
    return "done";
  } catch (e) {
    post({ ok: false, error: "fatal", detail: errOf(e) });
    return "done";
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
