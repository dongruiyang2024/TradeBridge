#!/usr/bin/env node
// Probe: wrap ALL inbound-message candidates at once and wait for a real
// message — so we learn WHICH callback actually fires, without two-phase timing.
//
// receive_capture wrapped instance.notifyReceiveMsg but it never fired on a
// real inbound message. Either (a) the message did not arrive / page reloaded,
// or (b) notifyReceiveMsg is not the receive hook and the real one is a
// delegateList method (e.g. onMessageSend) or an event emitter event.
//
// This probe, on the CONFIRMED live instance
// (IcbuIM.IMBaaSSDK.IcbuMessageServiceImpl.instance):
//   - wraps every function on the instance whose name looks message-related
//   - wraps every method of each delegateList entry
//   - wraps the IcbuEventServiceImpl emitter's emit()
// then keeps a persistent log on window of which wrapped target fired, with
// argument key paths (names only). One run installs + waits internally and
// reports whatever fired during the window; re-run to read more.
//
// Records names / type tags / event names only — never message text, cid,
// or tokens. All wrappers are pass-through.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = parseArgs(process.argv.slice(2));
const observeMs = Number(args.observeMs || args.observe || 45_000);
const timeoutMs = observeMs + 8_000;
const probeId = `tradebridgeFireProbe_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const tmp = mkdtempSync(join(tmpdir(), "tradebridge-onetalk-fire-"));

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
  const timeout = window.setTimeout(() => finish({ ok: false, error: "page_runtime_probe_timeout" }), ${Number(input.observeMs) + 5000});
  function onMessage(event) {
    if (event.source !== window || !event.data || event.data.source !== "tradebridge-fire-probe") return;
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
  const errOf = (e) => (e && (e.message || e.name)) ? String(e.message || e.name) : String(e);
  const post = (result) => { try { window.postMessage({ source: "tradebridge-fire-probe", probeId, result }, window.location.origin); } catch (e) {} };

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
  const argShape = (args) => args.map((a) => Array.isArray(a) ? "array(" + a.length + ")" : (a === null ? "null" : typeof a));
  const argPaths = (args) => args.map((a) => { const s = new Set(); keyPaths(a, "", 6, s); return Array.from(s).sort().slice(0, 140); });

  const G = (window.__tbFireStore = window.__tbFireStore || { wrapped: [], fires: [] });
  const record = (label, args) => { try { if (G.fires.length < 30) G.fires.push({ label, at: Date.now(), argTypes: argShape(args), argKeyPaths: argPaths(args) }); } catch {} };

  const fnNames = (obj) => {
    const out = new Set();
    try { for (const k of Object.getOwnPropertyNames(obj)) out.add(k); } catch {}
    try { const p = Object.getPrototypeOf(obj); if (p && p !== Object.prototype) for (const k of Object.getOwnPropertyNames(p)) if (k !== "constructor") out.add(k); } catch {}
    return Array.from(out).filter((k) => { try { return typeof obj[k] === "function"; } catch { return false; } });
  };

  const wrap = (obj, key, label) => {
    try {
      if (!obj || typeof obj[key] !== "function") return;
      const tag = "__tbFireW_" + key;
      if (obj[tag]) return;
      const orig = obj[key];
      obj[key] = function (...args) { record(label, args); return orig.apply(this, args); };
      obj[tag] = true;
      G.wrapped.push(label);
    } catch (e) {}
  };

  try {
    const sdk = window.IcbuIM && window.IcbuIM.IMBaaSSDK;
    if (!sdk) { post({ ok: false, error: "no_IMBaaSSDK" }); return "done"; }
    const inst = sdk.IcbuMessageServiceImpl && sdk.IcbuMessageServiceImpl.instance;
    if (!inst) { post({ ok: false, error: "no_message_instance" }); return "done"; }

    // 1) Message-related functions on the live instance.
    if (!G.wrapped.length) {
      for (const k of fnNames(inst)) {
        if (/msg|message|receive|notify|push|sync|chat|conv|read|collection|frame/i.test(k)) wrap(inst, k, "instance." + k);
      }
      // 2) Every method of each delegate.
      try {
        const list = inst.delegateList;
        if (Array.isArray(list)) list.forEach((d, i) => { if (d) for (const k of fnNames(d)) wrap(d, k, "delegate[" + i + "]." + k); });
      } catch (e) {}
      // 3) Event emitter emit().
      try {
        const em = sdk.IcbuEventServiceImpl && sdk.IcbuEventServiceImpl.instance && sdk.IcbuEventServiceImpl.instance.emitter;
        if (em) wrap(em, "emit", "eventEmitter.emit");
      } catch (e) {}
    }

    window.setTimeout(() => {
      post({
        ok: true,
        note: "Wrapped all inbound candidates and waited. 'firedLabels' shows which callback(s) actually ran on a real message. Send a real inbound message during the window.",
        observeMs,
        wrappedCount: G.wrapped.length,
        wrappedSample: G.wrapped.slice(0, 60),
        fireCount: G.fires.length,
        firedLabels: Array.from(new Set(G.fires.map((f) => f.label))),
        fires: G.fires.slice(0, 12)
      });
    }, observeMs);
    return "installed";
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
