#!/usr/bin/env node
// Probe: can we passively tap the page's own OneTalk WebSocket?
//
// Validates the core assumption behind the "page-driven, no second socket"
// refactor: by wrapping window.WebSocket (inbound) and patching
// WebSocket.prototype.send (outbound) we can observe the LWP frames that flow
// over the page's existing IM connection without opening a new one.
//
// Caveat: osascript injects AFTER the page has loaded, so a socket created
// before injection is only observable for OUTBOUND frames (prototype.send
// patch applies to live instances immediately). INBOUND frames are only
// captured on sockets created after the wrap (e.g. an IM reconnect) — in
// production the content script wraps the constructor at document_start, so
// the SDK's socket is caught from creation. Run with a real conversation open
// and scroll up to load history to maximise frame traffic.
//
// Privacy: reports only frame route (lwp), code, top-level/body KEY NAMES,
// data kind, and counts. Never prints token, cid, chatToken, names, or bodies.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = parseArgs(process.argv.slice(2));
const observeMs = Number(args.observeMs || args.observe || 20_000);
const timeoutMs = observeMs + 8_000;
const probeId = `tradebridgeWsTapProbe_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const tmp = mkdtempSync(join(tmpdir(), "tradebridge-onetalk-ws-tap-"));

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
      console.log(annotate(output));
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
  const finish = (result) => {
    state.done = true;
    state.result = JSON.stringify(result, null, 2);
  };
  const timeout = window.setTimeout(() => finish({ ok: false, error: "page_runtime_probe_timeout" }), ${Number(input.observeMs) + 4000});
  function onMessage(event) {
    if (event.source !== window || !event.data || event.data.source !== "tradebridge-ws-tap-probe") return;
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
  const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  const keyNames = (value) => (isRecord(value) ? Object.keys(value).sort().slice(0, 60) : []);

  // Aggregated, privacy-safe counters. We never store frame bodies or values.
  const inbound = { total: 0, parsed: 0, parseFailed: 0, kinds: {}, routes: {}, codes: {} };
  const outbound = { total: 0, parsed: 0, parseFailed: 0, kinds: {}, routes: {} };
  const bodyKeysByRoute = {};
  const headerKeysByRoute = {};
  const sockets = [];
  const sample = { realtimePush: false, listUserMessagesResponse: false };

  const bump = (bag, key) => { bag[key] = (bag[key] || 0) + 1; };

  const recordFrame = (dir, route, code, raw) => {
    const bag = dir === "in" ? inbound : outbound;
    bag.parsed += 1;
    const r = route || "(no-lwp-key)";
    bump(bag.routes, r);
    if (dir === "in" && typeof code === "number") bump(bag.codes, String(code));
    if (raw && isRecord(raw.headers)) {
      headerKeysByRoute[r] = Array.from(new Set([...(headerKeysByRoute[r] || []), ...keyNames(raw.headers)])).sort().slice(0, 60);
    }
    if (raw && "body" in raw && isRecord(raw.body)) {
      bodyKeysByRoute[r] = Array.from(new Set([...(bodyKeysByRoute[r] || []), ...keyNames(raw.body)])).sort().slice(0, 60);
    }
    if (typeof r === "string" && r.startsWith("/s/")) sample.realtimePush = true;
    if (typeof r === "string" && r.indexOf("listUserMessages") >= 0) sample.listUserMessagesResponse = true;
  };

  // Try to turn a frame payload into text, then parse LWP JSON. Blob is async,
  // so we sample blobs separately and decode the first few.
  const blobSamplePending = [];
  const handlePayload = (dir, data) => {
    const bag = dir === "in" ? inbound : outbound;
    bag.total += 1;
    let text = null;
    if (typeof data === "string") { bump(bag.kinds, "string"); text = data; }
    else if (data instanceof ArrayBuffer) { bump(bag.kinds, "arraybuffer"); try { text = new TextDecoder().decode(data); } catch {} }
    else if (typeof Blob !== "undefined" && data instanceof Blob) {
      bump(bag.kinds, "blob");
      if (blobSamplePending.length < 6) blobSamplePending.push({ dir, blob: data });
      return;
    } else if (ArrayBuffer.isView && ArrayBuffer.isView(data)) {
      bump(bag.kinds, "typedarray");
      try { text = new TextDecoder().decode(data); } catch {}
    } else { bump(bag.kinds, typeof data); }
    parseText(dir, text, bag);
  };

  const parseText = (dir, text, bag) => {
    if (typeof text !== "string" || !text) return;
    try {
      const raw = JSON.parse(text);
      if (!isRecord(raw)) { bag.parseFailed += 1; return; }
      recordFrame(dir, typeof raw.lwp === "string" ? raw.lwp : undefined, typeof raw.code === "number" ? raw.code : undefined, raw);
    } catch { bag.parseFailed += 1; }
  };

  // 1) Patch prototype.send — catches OUTBOUND on existing + future sockets.
  const NativeWS = window.WebSocket;
  const originalSend = NativeWS && NativeWS.prototype && NativeWS.prototype.send;
  if (originalSend) {
    NativeWS.prototype.send = function (data) {
      try { if (isImSocket(this.url)) handlePayload("out", data); } catch {}
      return originalSend.apply(this, arguments);
    };
  }

  // 2) Wrap constructor — catches INBOUND on sockets created AFTER injection.
  let wrappedConstructor = false;
  if (typeof NativeWS === "function") {
    const Wrapped = function (url, protocols) {
      const ws = protocols === undefined ? new NativeWS(url) : new NativeWS(url, protocols);
      try {
        if (isImSocket(url)) {
          sockets.push({ urlHost: hostOf(url), capturedInbound: true });
          ws.addEventListener("message", (event) => { try { handlePayload("in", event.data); } catch {} });
        }
      } catch {}
      return ws;
    };
    Wrapped.prototype = NativeWS.prototype;
    Wrapped.CONNECTING = NativeWS.CONNECTING; Wrapped.OPEN = NativeWS.OPEN;
    Wrapped.CLOSING = NativeWS.CLOSING; Wrapped.CLOSED = NativeWS.CLOSED;
    try { window.WebSocket = Wrapped; wrappedConstructor = true; } catch {}
  }

  function hostOf(url) { try { return new URL(String(url)).host; } catch { return "(unparsable)"; } }
  function isImSocket(url) {
    const u = String(url || "");
    return /dingtalk\\.com|icbu|wss-/i.test(u) || /alibaba\\.com/i.test(u);
  }

  // After the observation window, drain any blob samples then report.
  window.setTimeout(async () => {
    for (const item of blobSamplePending) {
      try {
        const text = await item.blob.text();
        parseText(item.dir, text, item.dir === "in" ? inbound : outbound);
      } catch {}
    }
    window.postMessage({
      source: "tradebridge-ws-tap-probe",
      probeId,
      result: {
        ok: true,
        note: "osascript injects post-load; inbound only captured on sockets created after wrap (e.g. reconnect). Outbound captured on all via prototype.send.",
        wrappedConstructor,
        patchedSend: !!originalSend,
        socketsCreatedAfterWrap: sockets.length,
        observedMs: observeMs,
        inbound,
        outbound,
        routesSeen: Array.from(new Set([...Object.keys(inbound.routes), ...Object.keys(outbound.routes)])).sort(),
        bodyKeysByRoute,
        headerKeysByRoute,
        signals: {
          tappedAnyImFrame: inbound.parsed + outbound.parsed > 0,
          capturedRealtimePush: sample.realtimePush,
          capturedListUserMessagesResponse: sample.listUserMessagesResponse
        }
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

function annotate(output) {
  let parsed;
  try { parsed = JSON.parse(output); } catch { return output; }
  if (parsed.ok === false) return output;
  const s = parsed.signals || {};
  const verdict = s.capturedRealtimePush
    ? "PASS: captured live /s/ push frames — passive realtime tap is viable."
    : s.tappedAnyImFrame
      ? "PARTIAL: tapped IM frames but no /s/ push during window. Re-run with a chat open + send/receive a message, or trigger an IM reconnect to test inbound capture."
      : "INCONCLUSIVE: no IM frames seen. Socket likely created before injection (no reconnect). In production the content script wraps at document_start, so this is an injection-timing artifact, not a blocker — but re-run after reloading the OneTalk tab to confirm inbound capture.";
  return JSON.stringify({ ...parsed, verdict }, null, 2);
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
