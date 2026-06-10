#!/usr/bin/env node
// Probe: deep-scan the OneTalk SDK object tree to LOCATE the live instance that
// actually receives messages (Plan B, locate phase).
//
// Findings so far: getMessageServiceV2() returns an instance whose delegateList
// is empty and which has no notifyReceiveMsg — i.e. NOT the instance the page
// uses to receive/render messages. That live instance is held somewhere inside
// the SDK object graph we haven't reached.
//
// This probe walks IcbuIM (bounded BFS, cycle-safe, names-only) and reports the
// PATHS of objects that look like the real receiver:
//   - own a non-empty delegateList / listeners / handlers array
//   - expose a notifyReceiveMsg / on*Message / *receive* function
//   - look like an event emitter (_events, emit + on)
// Reports object PATHS + key/method NAMES only — never values, message text,
// cids, or tokens.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = parseArgs(process.argv.slice(2));
const timeoutMs = Number(args.timeoutMs || args.timeout || 20_000);
const maxNodes = Number(args.maxNodes || 20_000);
const maxDepth = Number(args.maxDepth || 8);
const probeId = `tradebridgeSdkScanProbe_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const tmp = mkdtempSync(join(tmpdir(), "tradebridge-onetalk-sdk-scan-"));

try {
  const startResult = executeChromeJavascript(buildStartProbeJavascript({ probeId, timeoutMs, maxNodes, maxDepth }));
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
    if (event.source !== window || !event.data || event.data.source !== "tradebridge-sdk-scan-probe") return;
    if (event.data.probeId !== probeId) return;
    window.clearTimeout(timeout);
    window.removeEventListener("message", onMessage);
    finish(event.data.result);
  }
  window.addEventListener("message", onMessage);
  const script = document.createElement("script");
  script.textContent = ${JSON.stringify(buildPageRuntimeJavascript())}
    .replace(/__PROBE_ID__/g, probeId)
    .replace(/__MAX_NODES__/g, String(${Number(input.maxNodes)}))
    .replace(/__MAX_DEPTH__/g, String(${Number(input.maxDepth)}));
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
  const MAX_NODES = __MAX_NODES__;
  const MAX_DEPTH = __MAX_DEPTH__;
  const post = (result) => { try { window.postMessage({ source: "tradebridge-sdk-scan-probe", probeId, result }, window.location.origin); } catch (e) {} };
  const errOf = (e) => (e && (e.message || e.name)) ? String(e.message || e.name) : String(e);

  try {
    const root = window.IcbuIM;
    if (!root) { post({ ok: false, error: "no_IcbuIM" }); return "done"; }

    const isObj = (v) => v && (typeof v === "object" || typeof v === "function");
    const seen = new WeakSet();
    const hits = [];
    let visited = 0;
    let truncated = false;

    const methodNames = (v) => {
      const out = new Set();
      try { for (const k of Object.getOwnPropertyNames(v)) out.add(k); } catch {}
      try { const p = Object.getPrototypeOf(v); if (p && p !== Object.prototype) for (const k of Object.getOwnPropertyNames(p)) if (k !== "constructor") out.add(k); } catch {}
      return Array.from(out);
    };
    const isFn = (obj, k) => { try { return typeof obj[k] === "function"; } catch { return false; } };

    // What makes an object look like the live message receiver.
    const inspect = (obj, path) => {
      try {
        const names = methodNames(obj);
        const fns = names.filter((k) => isFn(obj, k));
        const ctor = (obj.constructor && obj.constructor.name) || typeof obj;

        // Signal 1: a non-empty delegate/listener/handler array.
        const listKeys = [];
        for (const k of names) {
          if (!/delegate|listener|handler|observer|subscriber|callbacks?/i.test(k)) continue;
          try { const v = obj[k]; if (Array.isArray(v) && v.length > 0) listKeys.push({ key: k, length: v.length, entryCtors: v.slice(0, 6).map((e) => (e && e.constructor && e.constructor.name) || typeof e) }); } catch {}
        }

        // Signal 2: receive/notify-style methods.
        const recvFns = fns.filter((k) => /notifyReceiveMsg|receiveMsg|onReceive|onMessage|onPush|handleMessage|dispatchMessage|notify.*(msg|message|receive)/i.test(k));

        // Signal 3: event-emitter shape.
        const emitterLike = (names.includes("_events") || names.includes("_listeners")) && fns.some((k) => /^(emit|on|addListener)$/.test(k));

        if (listKeys.length || recvFns.length || emitterLike) {
          hits.push({
            path,
            ctor,
            nonEmptyListKeys: listKeys,
            receiveFns: recvFns.slice(0, 20),
            emitterLike,
            allFns: fns.filter((k) => /msg|message|receive|notify|push|sync|listen|delegate|dispatch|emit/i.test(k)).slice(0, 30)
          });
        }
      } catch (e) { /* ignore single-node failure */ }
    };

    // Bounded BFS over the object graph (cycle-safe, names-only).
    const queue = [{ obj: root, path: "IcbuIM", depth: 0 }];
    seen.add(root);
    while (queue.length) {
      if (visited >= MAX_NODES) { truncated = true; break; }
      const { obj, path, depth } = queue.shift();
      visited += 1;
      inspect(obj, path);
      if (depth >= MAX_DEPTH) continue;

      let keys = [];
      try { keys = Object.getOwnPropertyNames(obj); } catch {}
      for (const k of keys) {
        if (k === "constructor" || k === "prototype" || k === "__proto__") continue;
        let child;
        try { child = obj[k]; } catch { continue; }
        if (!isObj(child)) continue;
        if (seen.has(child)) continue;
        // Skip DOM nodes / window to avoid exploding into the whole page.
        try { if (child === window || (typeof Node !== "undefined" && child instanceof Node)) continue; } catch {}
        seen.add(child);
        queue.push({ obj: child, path: path + "." + k, depth: depth + 1 });
      }
    }

    // Rank hits: non-empty delegate list first, then receive fns.
    hits.sort((a, b) => (b.nonEmptyListKeys.length - a.nonEmptyListKeys.length) || (b.receiveFns.length - a.receiveFns.length));

    post({
      ok: true,
      note: "Object PATHS + names only. Hits are candidate live-receiver instances: non-empty delegate/listener arrays, receive/notify methods, or emitter shape.",
      visited,
      truncated,
      hitCount: hits.length,
      hits: hits.slice(0, 40)
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
