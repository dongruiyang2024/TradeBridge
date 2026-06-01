#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = parseArgs(process.argv.slice(2));
const timeoutMs = Number(args.timeoutMs || args.timeout || 60_000);
const probeId = `tradebridgeSdkCallProbe_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const tmp = mkdtempSync(join(tmpdir(), "tradebridge-onetalk-sdk-calls-"));

try {
  const startResult = executeChromeJavascript(buildStartProbeJavascript({ probeId, timeoutMs }));
  if (startResult !== "started") {
    printJson({ ok: false, error: "probe_start_failed", startResult });
    process.exitCode = 1;
  } else {
    const deadline = Date.now() + timeoutMs;
    let output = "";
    while (Date.now() < deadline) {
      output = executeChromeJavascript(buildPollJavascript(probeId));
      if (output) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
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
  const state = { done: false, result: "" };
  window[probeId] = state;
  const finish = (result) => {
    state.done = true;
    state.result = JSON.stringify(result, null, 2);
  };
  const timeout = window.setTimeout(() => finish({ ok: false, error: "page_runtime_probe_timeout" }), ${Number(input.timeoutMs)});
  function onMessage(event) {
    if (event.source !== window || !event.data || event.data.source !== "tradebridge-sdk-call-probe") return;
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
  const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  const keys = (value) => (isRecord(value) ? Object.keys(value).sort() : []);
  const valueAtPath = (source, path) => {
    let current = source;
    for (const key of path.split(".")) {
      if (!isRecord(current)) return undefined;
      current = current[key];
    }
    return current;
  };
  const summarize = (value) => {
    const arrays = [];
    const visit = (current, path, depth) => {
      if (depth > 4 || arrays.length >= 12) return;
      if (Array.isArray(current)) {
        arrays.push({
          path,
          length: current.length,
          sampleKeys: keys(current.find(isRecord))
        });
        return;
      }
      if (!isRecord(current)) return;
      for (const key of Object.keys(current).slice(0, 40)) {
        visit(current[key], path ? path + "." + key : key, depth + 1);
      }
    };
    visit(value, "", 0);
    return {
      type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
      topKeys: keys(value),
      arrays
    };
  };
  const withTimeout = (label, promise, ms = 12_000) => Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + "_timeout")), ms))
  ]);
  const findConversationList = (value) => {
    const candidates = [
      value,
      valueAtPath(value, "data"),
      valueAtPath(value, "list"),
      valueAtPath(value, "data.list"),
      valueAtPath(value, "data.data"),
      valueAtPath(value, "listConversationPagination"),
      valueAtPath(value, "data.listConversationPagination")
    ];
    for (const candidate of candidates) {
      if (Array.isArray(candidate) && candidate.some(isRecord)) return candidate.filter(isRecord);
    }
    return [];
  };
  const firstString = (source, paths) => {
    for (const path of paths) {
      const value = path.includes(".") ? valueAtPath(source, path) : source?.[path];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
  };
  const conversationCode = (conversation) => firstString(conversation, [
    "conversationCode",
    "cid",
    "conversationContent.conversationCode",
    "conversationContent.cid",
    "singleChatUserConversation.singleChatConversation.cid"
  ]);
  const call = async (name, fn) => {
    try {
      const value = await withTimeout(name, fn());
      return { name, ok: true, summary: summarize(value) };
    } catch (error) {
      return { name, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  (async () => {
    const sdk = window.IcbuIM?.IMBaaSSDK?.default;
    const conversationService = sdk?.getConversationService?.();
    const conversationServiceV2 = sdk?.getConversationServiceV2?.();
    const messageService = sdk?.getMessageService?.();
    const messageServiceV2 = sdk?.getMessageServiceV2?.();
    const result = {
      ok: false,
      hasSdk: !!sdk,
      hasConversationService: !!conversationService,
      hasConversationServiceV2: !!conversationServiceV2,
      hasMessageService: !!messageService,
      hasMessageServiceV2: !!messageServiceV2,
      conversation: null,
      messageCalls: []
    };
    if (!conversationService || !messageService) {
      result.error = "sdk_service_unavailable";
      window.postMessage({ source: "tradebridge-sdk-call-probe", probeId, result }, window.location.origin);
      return;
    }

    const conversationCall = await call("getConversationListByPagination-object", () =>
      conversationService.getConversationListByPagination({ cursor: Date.now(), count: 20 })
    );
    let conversations = conversationCall.ok ? findConversationList(await withTimeout("conversation-list-repeat", conversationService.getConversationListByPagination({ cursor: Date.now(), count: 20 }))) : [];
    if (!conversations.length) {
      const legacyCall = await call("getConversationList-args", () => conversationService.getConversationList(Date.now(), 20));
      conversations = legacyCall.ok ? findConversationList(await withTimeout("conversation-list-legacy-repeat", conversationService.getConversationList(Date.now(), 20))) : [];
      result.conversation = { primaryCall: conversationCall, fallbackCall: legacyCall };
    } else {
      result.conversation = { primaryCall: conversationCall };
    }
    const selected = conversations.find((item) => !!conversationCode(item)) || conversations[0];
    const code = selected ? conversationCode(selected) : undefined;
    result.selectedConversation = selected ? {
      topKeys: keys(selected),
      conversationContentKeys: keys(selected.conversationContent),
      latestMessageKeys: keys(selected.latestMessage),
      latestMessageInnerKeys: keys(selected.latestMessage?.message),
      latestMessageOriginalDataKeys: keys(selected.latestMessage?.message?.originalData),
      contactKeys: keys(selected.contact),
      hasConversationCode: !!code,
      conversationCodeLength: code ? code.length : null
    } : null;

    if (selected && code) {
      const latestSendTime = selected.latestMessage?.message?.sendTime || selected.latestMessage?.gmtChatLong || selected.lastContactTimeLong;
      const v2Callback = (method, payload, fallbackError) => new Promise((resolve, reject) => {
        method.call(messageServiceV2, {
          ...payload,
          dataCallback: resolve,
          errorCallBack: (error) => reject(new Error(error?.err || error?.message || fallbackError))
        });
      });
      const seedMessage = {
        conversationCode: code,
        cid: code,
        contactAccountId: selected.accountId,
        messageId: selected.latestMessage?.messageId || selected.latestMessage?.message?.messageId,
        messageType: selected.latestMessage?.messageType || selected.latestMessage?.message?.messageType,
        originalData: { timeStamp: selected.latestMessage?.gmtChatLong || selected.latestMessage?.message?.sendTime },
        timeStamp: selected.latestMessage?.gmtChatLong || selected.latestMessage?.message?.sendTime,
        contact: selected.contact
      };
      const calls = [
        ["messageV2-listMessageWithConversationCode", () => new Promise((resolve, reject) => {
          messageServiceV2.listMessageWithConversationCode({
            conversationCode: code,
            cursor: Number.MAX_SAFE_INTEGER,
            count: 20,
            dataCallback: resolve,
            errorCallBack: (error) => reject(new Error(error?.err || error?.message || "message_v2_error"))
          });
        })],
        ["messageV2-listMessageWithConversationCodeForHistory", () => new Promise((resolve, reject) => {
          messageServiceV2.listMessageWithConversationCodeForHistory({
            conversationCode: code,
            cursor: Number.MAX_SAFE_INTEGER,
            count: 20,
            dataCallback: resolve,
            errorCallBack: (error) => reject(new Error(error?.err || error?.message || "message_v2_history_error"))
          });
        })],
        ["messageV2-listMessageWithConversationCode-fetchType-false", () =>
          v2Callback(messageServiceV2.listMessageWithConversationCode, {
            conversationCode: code,
            cursor: Number.MAX_SAFE_INTEGER,
            count: 20,
            fetchType: false
          }, "message_v2_error")],
        ["messageV2-listMessageWithConversationCode-cursor-sendTime", () =>
          v2Callback(messageServiceV2.listMessageWithConversationCode, {
            conversationCode: code,
            cursor: latestSendTime,
            count: 20,
            fetchType: false
          }, "message_v2_error")],
        ["messageV2-listMessageWithConversationCode-sendTime", () =>
          v2Callback(messageServiceV2.listMessageWithConversationCode, {
            conversationCode: code,
            sendTime: latestSendTime,
            count: 20,
            fetchType: false
          }, "message_v2_error")],
        ["messageV2-listMessageWithConversationCode-sendTime-now", () =>
          v2Callback(messageServiceV2.listMessageWithConversationCode, {
            conversationCode: code,
            sendTime: Date.now(),
            count: 20,
            fetchType: false
          }, "message_v2_error")],
        ["messageV2-listMessageWithConversationCode-sendTime-max", () =>
          v2Callback(messageServiceV2.listMessageWithConversationCode, {
            conversationCode: code,
            sendTime: Number.MAX_SAFE_INTEGER,
            count: 20,
            fetchType: false
          }, "message_v2_error")],
        ["messageV2-listMessageWithConversationCode-sendTime-fetchType-true", () =>
          v2Callback(messageServiceV2.listMessageWithConversationCode, {
            conversationCode: code,
            sendTime: latestSendTime,
            count: 20,
            fetchType: true
          }, "message_v2_error")],
        ["messageV2-listMessageWithConversationCodeForHistory-sendTime", () =>
          v2Callback(messageServiceV2.listMessageWithConversationCodeForHistory, {
            conversationCode: code,
            sendTime: latestSendTime,
            count: 20,
            fetchType: false
          }, "message_v2_history_error")],
        ["messageV2-listMessageWithConversationCodeForHistory-sendTime-fetchType-true", () =>
          v2Callback(messageServiceV2.listMessageWithConversationCodeForHistory, {
            conversationCode: code,
            sendTime: latestSendTime,
            count: 20,
            fetchType: true
          }, "message_v2_history_error")],
        ["messageV2-listMessageWithConversationCodeForHistory-cursor-sendTime", () =>
          v2Callback(messageServiceV2.listMessageWithConversationCodeForHistory, {
            conversationCode: code,
            cursor: latestSendTime,
            count: 20,
            fetchType: false
          }, "message_v2_history_error")],
        ["fetchMessagesWithoutUpdateToRead-conversation-count", () => messageService.fetchMessagesWithoutUpdateToRead(selected, 20)],
        ["fetchMessagesWithoutUpdateToRead-object-count", () => messageService.fetchMessagesWithoutUpdateToRead({ conversationCode: code }, 20)],
        ["fetchMessagesWithoutUpdateToRead-conversation-options", () =>
          messageService.fetchMessagesWithoutUpdateToRead({ ...selected, count: 20 }, { timeStamp: Date.now() })],
        ["fetchMessagesWithoutUpdateToRead-object-options", () =>
          messageService.fetchMessagesWithoutUpdateToRead({ conversationCode: code, cid: code, count: 20, contact: selected.contact }, { timeStamp: Date.now() })],
        ["fetchMessagesWithoutUpdateToRead-latest-message-contact", () =>
          messageService.fetchMessagesWithoutUpdateToRead(selected.latestMessage?.message, { contact: selected.contact })],
        ["fetchMessagesWithoutUpdateToRead-seed-message-contact", () =>
          messageService.fetchMessagesWithoutUpdateToRead(seedMessage, { contact: selected.contact })],
        ["searchRemoteHistoryMessage-object", () => messageService.searchRemoteHistoryMessage({ conversationCode: code, count: 20 })]
      ];
      for (const [name, fn] of calls) {
        result.messageCalls.push(await call(name, fn));
      }
    }
    result.ok = true;
    window.postMessage({ source: "tradebridge-sdk-call-probe", probeId, result }, window.location.origin);
  })();
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
