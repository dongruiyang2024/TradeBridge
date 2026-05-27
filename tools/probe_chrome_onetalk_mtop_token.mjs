#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = parseArgs(process.argv.slice(2));
const timeoutMs = Number(args.timeoutMs || args.timeout || 20_000);
const pollMs = Number(args.pollMs || 500);
const appKey = String(args.appKey || "12574478");
const explicitDeviceIds = values(args.deviceId).map(String).filter(Boolean);

const probeId = `tradebridgeOnetalkProbe_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const tmp = mkdtempSync(join(tmpdir(), "tradebridge-onetalk-probe-"));

try {
  const startResult = executeChromeJavascript(
    buildStartProbeJavascript({
      probeId,
      appKey,
      deviceIds: explicitDeviceIds,
      timeoutMs
    })
  );
  if (startResult !== "started") {
    printJson({ ok: false, error: "probe_start_failed", startResult });
    process.exitCode = 1;
  } else {
    const deadline = Date.now() + timeoutMs;
    let output = "";
    while (Date.now() < deadline) {
      output = executeChromeJavascript(buildPollJavascript(probeId));
      if (output) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollMs);
    }
    if (!output) {
      printJson({ ok: false, error: "probe_timeout" });
      process.exitCode = 1;
    } else {
      console.log(output);
      try {
        const parsed = JSON.parse(output);
        process.exitCode = parsed.ok === false ? 1 : 0;
      } catch {
        process.exitCode = 1;
      }
    }
  }
} catch (error) {
  printJson({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    hint: "Chrome may need View > Developer > Allow JavaScript from Apple Events enabled."
  });
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
  const config = ${JSON.stringify({
    appKey: input.appKey,
    deviceIds: input.deviceIds,
    timeoutMs: input.timeoutMs
  })};
  const state = { done: false, result: "" };
  window[probeId] = state;

  const finish = (result) => {
    state.done = true;
    state.result = JSON.stringify(result, null, 2);
  };

  const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  const keys = (value) => (isRecord(value) ? Object.keys(value).sort() : null);
  const oneLine = (value) => (typeof value === "string" ? value.replace(/\\s+/g, " ").slice(0, 500) : value);
  const tokenLength = (value) => (typeof value === "string" ? value.length : null);
  const tokenType = (value) => typeof value;

  function summarizeCandidate(path, value) {
    return {
      path,
      keys: keys(value),
      accessTokenType: tokenType(value?.accessToken),
      accessTokenLength: tokenLength(value?.accessToken),
      refreshTokenType: tokenType(value?.refreshToken),
      refreshTokenLength: tokenLength(value?.refreshToken),
      expiresType: tokenType(value?.accessTokenExpiredMillSeconds)
    };
  }

  function summarizeResponse(response) {
    const data = response?.data;
    const candidates = [
      summarizeCandidate("data.object", data?.object),
      summarizeCandidate("data", data),
      summarizeCandidate("data.result", data?.result),
      summarizeCandidate("object", response?.object),
      summarizeCandidate("result", response?.result)
    ];
    return {
      topKeys: keys(response),
      ret: Array.isArray(response?.ret) ? response.ret.map(oneLine) : response?.ret,
      retType: response?.retType,
      traceIdPresent: typeof response?.traceId === "string" && response.traceId.length > 0,
      code: response?.code,
      success: response?.success,
      dataKeys: keys(data),
      errorCode: oneLine(data?.errorCode),
      errorMsg: oneLine(data?.errorMsg),
      tokenFound: candidates.some((item) => item.accessTokenLength > 0),
      candidates
    };
  }

  function addCandidate(output, seen, value, source) {
    if (typeof value !== "string") return;
    const clean = value.trim();
    if (!clean || clean.length < 3 || clean.length > 256 || /\\s/.test(clean)) return;
    if (seen.has(clean)) return;
    seen.add(clean);
    output.push({ value: clean, source, length: clean.length });
  }

  function addTokenParamsCandidate(output, seen, appKey, deviceId, source) {
    if (typeof appKey !== "string" || typeof deviceId !== "string") return;
    const cleanAppKey = appKey.trim();
    const cleanDeviceId = deviceId.trim();
    if (!cleanAppKey || !cleanDeviceId || cleanDeviceId.length > 256 || /\\s/.test(cleanDeviceId)) return;
    const key = cleanAppKey + "\\n" + cleanDeviceId;
    if (seen.has(key)) return;
    seen.add(key);
    output.push({
      appKey: cleanAppKey,
      deviceId: cleanDeviceId,
      source,
      appKeyLength: cleanAppKey.length,
      deviceIdLength: cleanDeviceId.length
    });
  }

  function walkJsonForDeviceIds(output, seen, value, source, depth = 0) {
    if (depth > 4 || !isRecord(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (/device|deviceId|did/i.test(key)) addCandidate(output, seen, item, source + "." + key);
      if (isRecord(item)) walkJsonForDeviceIds(output, seen, item, source + "." + key, depth + 1);
    }
  }

  function collectStorageCandidates(storage, label, output, seen) {
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key) continue;
        const value = storage.getItem(key);
        if (/device|deviceId|did/i.test(key)) addCandidate(output, seen, value, label + "." + key);
        if (typeof value === "string" && value.startsWith("{")) {
          try {
            walkJsonForDeviceIds(output, seen, JSON.parse(value), label + "." + key);
          } catch {
            continue;
          }
        }
      }
    } catch {
      return;
    }
  }

  function collectDeviceCandidates() {
    const output = [];
    const seen = new Set();
    for (const id of config.deviceIds || []) addCandidate(output, seen, id, "cli");
    collectStorageCandidates(window.localStorage, "localStorage", output, seen);
    collectStorageCandidates(window.sessionStorage, "sessionStorage", output, seen);
    addCandidate(output, seen, "chrome-extension", "fallback");
    addCandidate(output, seen, "debug", "fallback");
    return output.slice(0, 25);
  }

  function collectPerformanceTokenParams(output, seen) {
    let parsed = [];
    try {
      parsed = performance
        .getEntriesByType("resource")
        .filter((entry) => typeof entry.name === "string" && entry.name.includes("mtop.alibaba.icbu.im.login.token.get"))
        .map((entry) => {
          try {
            const url = new URL(entry.name);
            const data = JSON.parse(url.searchParams.get("data") || "{}");
            return { appKey: data.appKey, deviceId: data.deviceId };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      parsed = [];
    }

    for (const item of parsed) {
      if (item.appKey !== config.appKey) addTokenParamsCandidate(output, seen, item.appKey, item.deviceId, "performance.resource.data");
    }
    for (const item of parsed) {
      addTokenParamsCandidate(output, seen, item.appKey, item.deviceId, "performance.resource.data");
    }
  }

  function collectTokenParamsCandidates() {
    const output = [];
    const tokenSeen = new Set();
    collectPerformanceTokenParams(output, tokenSeen);

    for (const item of collectDeviceCandidates()) {
      addTokenParamsCandidate(output, tokenSeen, config.appKey, item.value, item.source);
    }
    return output.slice(0, 25);
  }

  function requestMtopToken(tokenData, mode) {
    const request = window.lib?.mtop?.request;
    if (!request) return Promise.reject(new Error("onetalk_mtop_unavailable"));
    const options = {
      api: "mtop.alibaba.icbu.im.login.token.get",
      v: "1.0",
      appKey: config.appKey,
      dataType: "json",
      type: "GET",
      data: mode === "json-string" ? JSON.stringify(tokenData) : tokenData
    };
    return new Promise((resolve, reject) => {
      try {
        const maybePromise = request(options, resolve);
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(resolve, reject);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  (async () => {
    const environment = {
      href: location.href.replace(/([?&](?:chatToken|token|ctoken|_tb_token_|sign|data)=)[^&#]+/gi, "$1<redacted>"),
      hasLib: !!window.lib,
      hasMtop: !!window.lib?.mtop,
      requestType: typeof window.lib?.mtop?.request
    };
    const tokenParamCandidates = collectTokenParamsCandidates();
    const attempts = [];
    for (const candidate of tokenParamCandidates) {
      for (const mode of ["object", "json-string"]) {
        try {
          const response = await requestMtopToken(candidate, mode);
          const summary = summarizeResponse(response);
          attempts.push({
            tokenParams: {
              source: candidate.source,
              appKeyLength: candidate.appKeyLength,
              deviceIdLength: candidate.deviceIdLength,
              dataAppKeyMatchesQueryAppKey: candidate.appKey === config.appKey
            },
            mode,
            ...summary
          });
          if (summary.tokenFound) {
            finish({ ok: true, environment, candidateCount: tokenParamCandidates.length, attempts });
            return;
          }
        } catch (error) {
          attempts.push({
            tokenParams: {
              source: candidate.source,
              appKeyLength: candidate.appKeyLength,
              deviceIdLength: candidate.deviceIdLength,
              dataAppKeyMatchesQueryAppKey: candidate.appKey === config.appKey
            },
            mode,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
    finish({ ok: false, error: "no_token_candidate_succeeded", environment, candidateCount: tokenParamCandidates.length, attempts });
  })().catch((error) => finish({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  return "started";
})()
`;
}

function buildPollJavascript(probeId) {
  return `
(() => {
  const state = window[${JSON.stringify(probeId)}];
  return state && state.done ? state.result : "";
})()
`;
}

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      output[key] = true;
    } else if (output[key] === undefined) {
      output[key] = next;
      index += 1;
    } else if (Array.isArray(output[key])) {
      output[key].push(next);
      index += 1;
    } else {
      output[key] = [output[key], next];
      index += 1;
    }
  }
  return output;
}

function values(value) {
  if (value === undefined || value === true) return [];
  return Array.isArray(value) ? value : [value];
}

function escapeAppleString(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}
