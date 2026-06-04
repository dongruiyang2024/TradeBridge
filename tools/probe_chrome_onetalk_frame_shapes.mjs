#!/usr/bin/env node
// Probe: dump the SHAPE of message-related LWP frames flowing over the page's
// own OneTalk socket — so we can see what realtime push frames actually look
// like, vs the listUserMessages response shape our parser assumes.
//
// The passive tap currently extracts messages via body.userMessageModels
// (the listUserMessages RESPONSE shape). Realtime new messages arrive as
// server PUSH frames (/s/...), whose body shape is likely different. This
// probe records, per frame route, the recursive KEY PATHS of the body (key
// names only, never values) plus whether userMessageModels is present — enough
// to fix the parser without ever printing message text, cid, or tokens.
//
// Run with a conversation open; send/receive a real message and scroll up to
// load history, to capture both push frames and any history-load responses.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = parseArgs(process.argv.slice(2));
const observeMs = Number(args.observeMs || args.observe || 30_000);
const timeoutMs = observeMs + 8_000;
const probeId = `tradebridgeFrameShapeProbe_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const tmp = mkdtempSync(join(tmpdir(), "tradebridge-onetalk-frame-shapes-"));

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
    if (event.source !== window || !event.data || event.data.source !== "tradebridge-frame-shape-probe") return;
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

  // Recursively collect KEY PATHS (names only, never values) up to a depth.
  const keyPaths = (value, prefix, depth, out) => {
    if (depth < 0) return;
    if (Array.isArray(value)) {
      if (value.length) keyPaths(value[0], prefix + "[]", depth - 1, out);
      return;
    }
    if (!isRecord(value)) return;
    for (const k of Object.keys(value)) {
      const path = prefix ? prefix + "." + k : k;
      out.add(path);
      keyPaths(value[k], path, depth - 1, out);
    }
  };

  // Per-route aggregation: count, body top keys, deep body key paths,
  // and whether the shapes our parser/ack rely on are present.
  // Per-route aggregation: full top-level keys, header keys, body type, and
  // deep frame key paths (names only) — so message data is visible wherever it
  // hides, not just under body.userMessageModels.
  const routes = {};
  const record = (dir, frame) => {
    const route = (typeof frame.lwp === "string" ? frame.lwp : "(no-lwp)") + " [" + dir + "]";
    const r = routes[route] || (routes[route] = {
      count: 0, codes: new Set(), topKeys: new Set(), headerKeys: new Set(),
      bodyTypes: new Set(), frameKeyPaths: new Set(),
      hasUserMessageModels: false, hasMessageIdLike: false
    });
    r.count += 1;
    if (typeof frame.code === "number") r.codes.add(frame.code);
    Object.keys(frame).forEach((k) => r.topKeys.add(k));
    if (isRecord(frame.headers)) Object.keys(frame.headers).forEach((k) => r.headerKeys.add(k));
    const body = frame.body;
    r.bodyTypes.add(Array.isArray(body) ? "array(" + body.length + ")" : body === null ? "null" : typeof body);
    const s = new Set();
    keyPaths(frame, "", 5, s);
    s.forEach((p) => r.frameKeyPaths.add(p));
    // Key-name presence only; never emits values.
    const text = JSON.stringify(frame) || "";
    if (text.indexOf("userMessageModels") >= 0) r.hasUserMessageModels = true;
    if (/"(messageId|msgId|msgIdStr|messageID)"/.test(text)) r.hasMessageIdLike = true;
  };

  const onFrame = (dir, text) => {
    if (typeof text !== "string") return;
    let frame; try { frame = JSON.parse(text); } catch { return; }
    if (!isRecord(frame)) return;
    record(dir, frame);
  };

  const NativeWS = window.WebSocket;
  if (typeof NativeWS !== "function") { window.postMessage({ source: "tradebridge-frame-shape-probe", probeId, result: { ok: false, error: "no_websocket" } }, window.location.origin); return; }
  const TAG = "__tbFrameShapeTapped_" + probeId;
  const isIm = (u) => /dingtalk\\.com|icbu|wss-/i.test(String(u || ""));
  const tap = (ws) => { try { if (ws[TAG]) return; ws[TAG] = true; ws.addEventListener("message", (e) => { try { if (typeof e.data === "string") onFrame("in", e.data); } catch {} }); } catch {} };

  const origSend = NativeWS.prototype.send;
  if (typeof origSend === "function") {
    NativeWS.prototype.send = function (...a) { try { if (isIm(this.url)) { tap(this); onFrame("out", a[0]); } } catch {} return origSend.apply(this, a); };
  }
  const Wrapped = function (url, protocols) { const ws = protocols === undefined ? new NativeWS(url) : new NativeWS(url, protocols); try { if (isIm(url)) tap(ws); } catch {} return ws; };
  Wrapped.prototype = NativeWS.prototype;
  for (const k of ["CONNECTING","OPEN","CLOSING","CLOSED"]) Wrapped[k] = NativeWS[k];
  try { window.WebSocket = Wrapped; } catch {}

  window.setTimeout(() => {
    const out = {};
    for (const [route, r] of Object.entries(routes)) {
      out[route] = {
        count: r.count,
        codes: Array.from(r.codes),
        topKeys: Array.from(r.topKeys).sort(),
        headerKeys: Array.from(r.headerKeys).sort().slice(0, 60),
        bodyTypes: Array.from(r.bodyTypes),
        hasUserMessageModels: r.hasUserMessageModels,
        hasMessageIdLike: r.hasMessageIdLike,
        frameKeyPaths: Array.from(r.frameKeyPaths).sort().slice(0, 160)
      };
    }
    window.postMessage({
      source: "tradebridge-frame-shape-probe",
      probeId,
      result: {
        ok: true,
        note: "Key names only, no values. To test realtime push, have ANOTHER account message this seller during the window. hasMessageIdLike flags any frame carrying a message id.",
        observedMs: observeMs,
        routes: out
      }
    }, window.location.origin);
  }, observeMs);

  return "installed";
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
