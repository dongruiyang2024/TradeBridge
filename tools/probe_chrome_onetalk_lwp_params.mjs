#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = parseArgs(process.argv.slice(2));
const timeoutMs = Number(args.timeoutMs || args.timeout || 240_000);
const requestTimeoutMs = Number(args.requestTimeoutMs || 12_000);
const appKey = String(args.appKey || "12574478");
const deviceId = String(args.deviceId || "debug-lwp-params");
const probeId = `tradebridgeLwpParamProbe_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const tmp = mkdtempSync(join(tmpdir(), "tradebridge-onetalk-lwp-param-probe-"));

try {
  const startResult = executeChromeJavascript(
    buildStartProbeJavascript({ probeId, timeoutMs, requestTimeoutMs, appKey, deviceId })
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
set jsCode to read (POSIX file "${escapeAppleString(jsPath)}")
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
  const config = ${JSON.stringify(input)};
  const state = { done: false, result: "" };
  window[probeId] = state;

  const finish = (result) => {
    state.done = true;
    state.result = JSON.stringify(result, null, 2);
  };
  const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  const keys = (value) => (isRecord(value) ? Object.keys(value).sort() : []);
  const firstValue = (source, paths) => {
    for (const path of paths) {
      let current = source;
      for (const key of path.split(".")) {
        if (!isRecord(current)) {
          current = undefined;
          break;
        }
        current = current[key];
      }
      if (current !== undefined && current !== null && current !== "") return current;
    }
  };
  const firstString = (source, paths) => {
    const value = firstValue(source, paths);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  };
  const firstNumber = (source, paths) => {
    const value = firstValue(source, paths);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^\\d+$/.test(value)) return Number(value);
  };
  const pathValue = (source, path) => {
    let current = source;
    for (const key of path.split(".")) {
      if (!isRecord(current)) return undefined;
      current = current[key];
    }
    return current;
  };
  const sanitizeBodySignature = (body, cidSource) => ({
    cidSource,
    argCount: Array.isArray(body) ? body.length : null,
    argTypes: Array.isArray(body) ? body.map((item) => item === null ? "null" : typeof item) : [],
    bool2: Array.isArray(body) && typeof body[1] === "boolean" ? body[1] : null,
    cursorType: Array.isArray(body) ? (body[2] === null ? "null" : typeof body[2]) : null,
    cursorKind: Array.isArray(body) ? cursorKind(body[2]) : null,
    pageSize: Array.isArray(body) && typeof body[3] === "number" ? body[3] : null,
    bool5: Array.isArray(body) && typeof body[4] === "boolean" ? body[4] : null
  });
  const cursorKind = (value) => {
    if (value === Number.MAX_SAFE_INTEGER) return "max_safe_integer";
    if (value === null) return "null";
    if (value === 0) return "zero";
    if (typeof value === "number" && value > 1_000_000_000_000) return "epoch_ms_like";
    if (typeof value === "number") return "number";
    return typeof value;
  };
  const requestPageBridge = (type, payload, timeout) => new Promise((resolve) => {
    const requestId = "probe-" + type + "-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    const resultType = type + "-result";
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve({ ok: false, error: type + "_timeout" });
    }, timeout);
    function onMessage(event) {
      if (event.source !== window || !isRecord(event.data)) return;
      if (event.data.source !== "tradebridge-onetalk-page") return;
      if (event.data.type !== resultType || event.data.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(event.data);
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "tradebridge-extension", type, requestId, ...payload }, window.location.origin);
  });

  const summarizeFrame = (frame) => ({
    code: typeof frame?.code === "number" ? frame.code : null,
    route: typeof frame?.lwp === "string" ? frame.lwp : null,
    headerKeys: keys(frame?.headers),
    bodyKeys: keys(frame?.body),
    userConvsCount: Array.isArray(frame?.body?.userConvs) ? frame.body.userConvs.length : null,
    userMessageModelsCount: Array.isArray(frame?.body?.userMessageModels) ? frame.body.userMessageModels.length : null,
    hasMore: typeof frame?.body?.hasMore === "boolean" ? frame.body.hasMore : null,
    nextCursorType: frame?.body?.nextCursor == null ? null : typeof frame.body.nextCursor
  });
  const summarizeMessages = (models) => models.slice(0, 3).map((model) => {
    const message = isRecord(model.message) ? model.message : model;
    return {
      modelKeys: keys(model),
      messageKeys: keys(message),
      contentKeys: keys(message.content),
      searchableContentKeys: keys(message.searchableContent),
      senderKeys: keys(message.sender),
      receiversType: Array.isArray(message.receivers) ? "array" : typeof message.receivers,
      hasMessageId: !!message.messageId,
      hasCid: !!message.cid,
      hasCreateAt: !!message.createAt,
      contentType: isRecord(message.content) ? message.content.contentType : undefined,
      contentTextLength: typeof message.content?.text?.content === "string" ? message.content.text.content.length : 0,
      summaryLength: typeof message.searchableContent?.summary === "string" ? message.searchableContent.summary.length : 0
    };
  });
  const summarizeUnmatched = (frames) => frames.slice(-8).map((frame) => ({
    route: typeof frame.lwp === "string" ? frame.lwp : null,
    code: typeof frame.code === "number" ? frame.code : null,
    hasMid: typeof frame.headers?.mid === "string",
    headerKeys: keys(frame.headers),
    bodyKeys: keys(frame.body),
    userMessageModelsCount: Array.isArray(frame.body?.userMessageModels) ? frame.body.userMessageModels.length : null
  }));

  const makeLwpSession = async (token) => {
    const socket = new WebSocket("wss://wss-icbu.dingtalk.com/");
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("ws_open_timeout")), 15_000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("ws_error"));
      }, { once: true });
    });

    let sequence = 1;
    const pending = new Map();
    const unmatched = [];
    socket.addEventListener("message", (event) => {
      let frame;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      if (typeof frame.lwp === "string" && frame.lwp.startsWith("/s/")) {
        socket.send(JSON.stringify({ code: 200, headers: frame.headers || {} }));
      }
      const mid = frame?.headers?.mid;
      const request = typeof mid === "string" ? pending.get(mid) : null;
      if (!request) {
        unmatched.push(frame);
        if (unmatched.length > 40) unmatched.shift();
        return;
      }
      pending.delete(mid);
      clearTimeout(request.timer);
      request.resolve(frame);
    });

    const request = (lwp, body, extraHeaders = {}, timeout = config.requestTimeoutMs) => new Promise((resolve, reject) => {
      const mid = Math.floor(Math.random() * 1000) + String(Date.now()) + " " + sequence++;
      const timer = setTimeout(() => {
        pending.delete(mid);
        reject(new Error("lwp_timeout:" + lwp));
      }, timeout);
      pending.set(mid, { resolve, reject, timer });
      const frame = body === undefined ? { lwp, headers: { mid, ...extraHeaders } } : { lwp, headers: { mid, ...extraHeaders }, body };
      socket.send(JSON.stringify(frame));
    });

    const close = () => {
      try { socket.close(); } catch {}
    };

    const register = async () => request("/reg", undefined, {
      "app-key": token.appKey || config.appKey,
      did: token.deviceId || config.deviceId,
      token: token.accessToken,
      ua: navigator.userAgent + " DingTalk(2.1.0-beta.22) DingWeb/2.1.0-beta.22 IMPaaS",
      dt: "j",
      wv: "im:3,au:3,sy:6",
      sync: "0,0;0;0;",
      "cache-header": "app-key token ua wv"
    }, 20_000);

    return { socket, request, register, close, unmatched };
  };

  const setupAndCallMessage = async (token, scenario, cid, body) => {
    const startedAt = Date.now();
    const session = await makeLwpSession(token);
    const setup = { registered: false, state: false, conversations: false, ack: false, heartbeat: false };
    const setupFrames = {};
    try {
      const registerFrame = await session.register();
      setup.registered = true;
      setupFrames.register = summarizeFrame(registerFrame);
      let stateFrame;
      if (scenario.getState || scenario.ack) {
        stateFrame = await session.request("/r/SyncStatus/getState", [{ topic: "sync" }]);
        setup.state = true;
        setupFrames.state = summarizeFrame(stateFrame);
      }
      if (scenario.conversations) {
        const conversationsFrame = await session.request("/r/Conversation/listNewestPagination", [Date.now(), 100]);
        setup.conversations = true;
        setupFrames.conversations = summarizeFrame(conversationsFrame);
      }
      if (scenario.ack && isRecord(stateFrame?.body)) {
        const ackFrame = await session.request("/r/SyncStatus/ackDiff", [stateFrame.body]).catch((error) => ({
          error: error instanceof Error ? error.message : String(error)
        }));
        setup.ack = true;
        setupFrames.ack = isRecord(ackFrame) && !("error" in ackFrame) ? summarizeFrame(ackFrame) : ackFrame;
      }
      if (scenario.heartbeat) {
        const heartbeatFrame = await session.request("/!", undefined).catch((error) => ({
          error: error instanceof Error ? error.message : String(error)
        }));
        setup.heartbeat = true;
        setupFrames.heartbeat = isRecord(heartbeatFrame) && !("error" in heartbeatFrame) ? summarizeFrame(heartbeatFrame) : heartbeatFrame;
      }
      const frame = await session.request("/r/MessageManager/listUserMessages", body);
      const models = Array.isArray(frame.body?.userMessageModels) ? frame.body.userMessageModels.filter(isRecord) : [];
      return {
        ok: true,
        durationMs: Date.now() - startedAt,
        setup,
        setupFrames,
        frame: summarizeFrame(frame),
        messageSamples: summarizeMessages(models),
        unmatched: summarizeUnmatched(session.unmatched)
      };
    } catch (error) {
      return {
        ok: false,
        durationMs: Date.now() - startedAt,
        setup,
        setupFrames,
        error: error instanceof Error ? error.message : String(error),
        unmatched: summarizeUnmatched(session.unmatched)
      };
    } finally {
      session.close();
    }
  };

  const addCandidate = (items, label, value) => {
    if (typeof value !== "string" || !value.trim()) return;
    if (items.some((item) => item.value === value)) return;
    items.push({ label, value });
  };

  (async () => {
    const result = {
      ok: false,
      page: {
        title: document.title,
        readyState: document.readyState,
        hasPageBridge: !!window.__tradeBridgeOneTalkPageBridgeInstalled
      },
      token: null,
      discovery: null,
      matrix: []
    };

    try {
      const token = await requestPageBridge("get-onetalk-im-token", {
        appKey: config.appKey,
        deviceId: config.deviceId
      }, 20_000);
      result.token = {
        ok: token.ok === true,
        error: token.ok === true ? undefined : token.error,
        hasAccessToken: typeof token.accessToken === "string" && token.accessToken.length > 0,
        hasRefreshToken: typeof token.refreshToken === "string" && token.refreshToken.length > 0,
        expiresInMsType: typeof token.expiresInMs,
        appKeyReturned: typeof token.appKey === "string",
        deviceIdReturned: typeof token.deviceId === "string"
      };
      if (token.ok !== true || typeof token.accessToken !== "string") {
        finish(result);
        return;
      }

      const discovery = await makeLwpSession(token);
      const registerFrame = await discovery.register();
      const stateFrame = await discovery.request("/r/SyncStatus/getState", [{ topic: "sync" }]);
      const conversationFrame = await discovery.request("/r/Conversation/listNewestPagination", [Date.now(), 100]);
      const conversations = Array.isArray(conversationFrame.body?.userConvs) ? conversationFrame.body.userConvs.filter(isRecord) : [];
      const selected = conversations.find((conversation) =>
        !!firstString(conversation, ["singleChatUserConversation.singleChatConversation.cid"]) ||
        !!firstString(conversation, ["singleChatUserConversation.lastMessage.message.cid"])
      );
      if (!selected) {
        result.discovery = {
          register: summarizeFrame(registerFrame),
          state: summarizeFrame(stateFrame),
          conversations: summarizeFrame(conversationFrame),
          selectedConversation: null
        };
        discovery.close();
        finish(result);
        return;
      }
      const candidates = [];
      addCandidate(candidates, "singleChatConversation.cid", firstString(selected, ["singleChatUserConversation.singleChatConversation.cid"]));
      addCandidate(candidates, "lastMessage.message.cid", firstString(selected, ["singleChatUserConversation.lastMessage.message.cid"]));
      addCandidate(candidates, "topLevel.cid", firstString(selected, ["cid"]));
      const lastCreateAt = firstNumber(selected, ["singleChatUserConversation.lastMessage.message.createAt"]);
      const modifyTime = firstNumber(selected, ["singleChatUserConversation.modifyTime"]);
      const primary = candidates[0];
      let sameSessionMessage = null;
      const sameSessionMessages = [];
      try {
        const ackFrame = isRecord(stateFrame.body)
          ? await discovery.request("/r/SyncStatus/ackDiff", [stateFrame.body]).catch((error) => ({
              error: error instanceof Error ? error.message : String(error)
            }))
          : null;
        const recordMessageRequest = async (name, body) => {
          try {
            const frame = await discovery.request("/r/MessageManager/listUserMessages", body);
            const models = Array.isArray(frame.body?.userMessageModels) ? frame.body.userMessageModels.filter(isRecord) : [];
            const item = {
              ok: true,
              name,
              body: sanitizeBodySignature(body, primary.label),
              frame: summarizeFrame(frame),
              messageSamples: summarizeMessages(models),
              unmatched: summarizeUnmatched(discovery.unmatched)
            };
            sameSessionMessages.push(item);
            return { ok: true, frame: item.frame, nextCursor: frame.body?.nextCursor };
          } catch (error) {
            const item = {
              ok: false,
              name,
              body: sanitizeBodySignature(body, primary.label),
              error: error instanceof Error ? error.message : String(error),
              unmatched: summarizeUnmatched(discovery.unmatched)
            };
            sameSessionMessages.push(item);
            return { ok: false, error: item.error };
          }
        };
        const defaultBody = [primary.value, false, Number.MAX_SAFE_INTEGER, 20, false];
        const defaultRequest = await recordMessageRequest("har-default-20", defaultBody);
        await recordMessageRequest("plugin-default-50", [primary.value, false, Number.MAX_SAFE_INTEGER, 50, false]);
        const pageSize10 = await recordMessageRequest("page-size-10", [primary.value, false, Number.MAX_SAFE_INTEGER, 10, false]);
        if (pageSize10.ok && pageSize10.nextCursor != null) {
          await recordMessageRequest("second-page-nextCursor-size-10", [primary.value, false, pageSize10.nextCursor, 10, false]);
        }
        await recordMessageRequest("page-size-2", [primary.value, false, Number.MAX_SAFE_INTEGER, 2, false]);
        sameSessionMessage = {
          ok: defaultRequest.ok,
          setupFrames: {
            ack: isRecord(ackFrame) && !("error" in ackFrame) ? summarizeFrame(ackFrame) : ackFrame
          },
          body: sanitizeBodySignature(defaultBody, primary.label),
          frame: defaultRequest.frame,
          messageSamples: defaultRequest.messageSamples || [],
          error: defaultRequest.error,
          unmatched: summarizeUnmatched(discovery.unmatched)
        };
      } catch (error) {
        sameSessionMessage = {
          ok: false,
          body: sanitizeBodySignature([primary.value, false, Number.MAX_SAFE_INTEGER, 20, false], primary.label),
          error: error instanceof Error ? error.message : String(error),
          unmatched: summarizeUnmatched(discovery.unmatched)
        };
      }
      result.discovery = {
        register: summarizeFrame(registerFrame),
        state: summarizeFrame(stateFrame),
        conversations: summarizeFrame(conversationFrame),
        selectedConversation: {
          topKeys: keys(selected),
          wrapperKeys: keys(pathValue(selected, "singleChatUserConversation")),
          singleChatConversationKeys: keys(pathValue(selected, "singleChatUserConversation.singleChatConversation")),
          lastMessageKeys: keys(pathValue(selected, "singleChatUserConversation.lastMessage")),
          lastMessageInnerKeys: keys(pathValue(selected, "singleChatUserConversation.lastMessage.message")),
          candidateCidSources: candidates.map((item) => ({
            label: item.label,
            length: item.value.length,
            equalsFirst: item.value === candidates[0]?.value
          })),
          lastCreateAtType: lastCreateAt == null ? null : typeof lastCreateAt,
          modifyTimeType: modifyTime == null ? null : typeof modifyTime
        },
        sameSessionMessage,
        sameSessionMessages,
        unmatched: summarizeUnmatched(discovery.unmatched)
      };
      discovery.close();

      const bodies = [
        { name: "har-default-20", cidSource: primary.label, body: [primary.value, false, Number.MAX_SAFE_INTEGER, 20, false] },
        { name: "plugin-default-50", cidSource: primary.label, body: [primary.value, false, Number.MAX_SAFE_INTEGER, 50, false] },
        ...(lastCreateAt ? [
          { name: "cursor-last-createAt-20", cidSource: primary.label, body: [primary.value, false, lastCreateAt, 20, false] },
          { name: "cursor-before-last-createAt-20", cidSource: primary.label, body: [primary.value, false, Math.max(0, lastCreateAt - 1), 20, false] }
        ] : []),
        ...(modifyTime && modifyTime !== lastCreateAt ? [
          { name: "cursor-modifyTime-20", cidSource: primary.label, body: [primary.value, false, modifyTime, 20, false] }
        ] : []),
        { name: "direction-true-20", cidSource: primary.label, body: [primary.value, true, Number.MAX_SAFE_INTEGER, 20, false] },
        { name: "tail-flag-true-20", cidSource: primary.label, body: [primary.value, false, Number.MAX_SAFE_INTEGER, 20, true] },
        { name: "cursor-null-20", cidSource: primary.label, body: [primary.value, false, null, 20, false] },
        { name: "cursor-zero-20", cidSource: primary.label, body: [primary.value, false, 0, 20, false] },
        ...candidates.slice(1).map((candidate) => ({
          name: "cid-source-" + candidate.label,
          cidSource: candidate.label,
          body: [candidate.value, false, Number.MAX_SAFE_INTEGER, 20, false]
        }))
      ];
      const scenarios = [
        { name: "state-conv-ack", getState: true, conversations: true, ack: true, heartbeat: false },
        { name: "state-no-ack", getState: true, conversations: false, ack: false, heartbeat: false },
        { name: "state-conv-no-ack", getState: true, conversations: true, ack: false, heartbeat: false },
        { name: "register-only", getState: false, conversations: false, ack: false, heartbeat: false },
        { name: "state-conv-ack-heartbeat", getState: true, conversations: true, ack: true, heartbeat: true }
      ];
      const matrixPlan = [
        ...bodies.map((body) => ({ scenario: scenarios[0], body })),
        ...scenarios.slice(1).map((scenario) => ({ scenario, body: bodies[0] }))
      ];

      for (const item of matrixPlan) {
        const call = await setupAndCallMessage(token, item.scenario, item.body.body[0], item.body.body);
        result.matrix.push({
          name: item.scenario.name + "::" + item.body.name,
          scenario: item.scenario.name,
          body: sanitizeBodySignature(item.body.body, item.body.cidSource),
          result: call
        });
        const messageCount = call.frame?.userMessageModelsCount || 0;
        if (messageCount > 0) break;
      }

      result.ok = true;
      finish(result);
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      finish(result);
    }
  })();
  return "started";
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
