#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = parseArgs(process.argv.slice(2));
const timeoutMs = Number(args.timeoutMs || args.timeout || 60_000);
const appKey = String(args.appKey || "12574478");
const deviceId = String(args.deviceId || "debug-probe");
const probeId = `tradebridgeFullProbe_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const tmp = mkdtempSync(join(tmpdir(), "tradebridge-onetalk-full-probe-"));

try {
  const startResult = executeChromeJavascript(buildStartProbeJavascript({ probeId, timeoutMs, appKey, deviceId }));
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
  const parseCustom = (conversation) => {
    const custom = firstValue(conversation, [
      "singleChatUserConversation.user_extension.custom",
      "singleChatUserConversation.userExtension.custom"
    ]);
    if (isRecord(custom)) return custom;
    if (typeof custom !== "string" || !custom.trim()) return {};
    try {
      const parsed = JSON.parse(custom);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  };
  const conversationCid = (conversation) =>
    firstString(conversation, [
      "singleChatUserConversation.singleChatConversation.cid",
      "cid",
      "conversationCode",
      "conversationId",
      "id"
    ]);
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

  const makeLwpClient = (socket) => {
    let sequence = 1;
    const pending = new Map();
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
      const mid = frame && frame.headers && frame.headers.mid;
      const request = mid ? pending.get(mid) : null;
      if (!request) return;
      pending.delete(mid);
      clearTimeout(request.timer);
      request.resolve(frame);
    });
    return (lwp, body, extraHeaders = {}) => new Promise((resolve, reject) => {
      const mid = Math.floor(Math.random() * 1000) + String(Date.now()) + " " + sequence++;
      const timer = setTimeout(() => {
        pending.delete(mid);
        reject(new Error("lwp_timeout:" + lwp));
      }, 20_000);
      pending.set(mid, { resolve, timer });
      const frame = body === undefined ? { lwp, headers: { mid, ...extraHeaders } } : { lwp, headers: { mid, ...extraHeaders }, body };
      socket.send(JSON.stringify(frame));
    });
  };

  const summarizeMessages = (models) => models.slice(0, 5).map((model) => {
    const message = isRecord(model.message) ? model.message : model;
    return {
      modelKeys: keys(model),
      messageKeys: keys(message),
      contentKeys: keys(message.content),
      searchableContentKeys: keys(message.searchableContent),
      senderKeys: keys(message.sender),
      hasMessageId: !!message.messageId,
      hasCid: !!message.cid,
      hasCreateAt: !!message.createAt,
      contentType: isRecord(message.content) ? message.content.contentType : undefined,
      contentTextLength: typeof message.content?.text?.content === "string" ? message.content.text.content.length : 0,
      summaryLength: typeof message.searchableContent?.summary === "string" ? message.searchableContent.summary.length : 0
    };
  });

  (async () => {
    const result = {
      ok: false,
      page: {
        title: document.title,
        readyState: document.readyState,
        hasPageBridge: !!window.__tradeBridgeOneTalkPageBridgeInstalled,
        bodyTextLength: document.body ? document.body.innerText.length : 0
      },
      token: null,
      lwp: null,
      profiles: null
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
      const request = makeLwpClient(socket);
      const register = await request("/reg", undefined, {
        "app-key": token.appKey || config.appKey,
        did: token.deviceId || config.deviceId,
        token: token.accessToken,
        ua: navigator.userAgent + " DingTalk(2.1.0-beta.22) DingWeb/2.1.0-beta.22 IMPaaS",
        dt: "j",
        wv: "im:3,au:3,sy:6",
        sync: "0,0;0;0;",
        "cache-header": "app-key token ua wv"
      });
      const stateFrame = await request("/r/SyncStatus/getState", [{ topic: "sync" }]);
      const conversationFrame = await request("/r/Conversation/listNewestPagination", [Date.now(), 100]);
      if (isRecord(stateFrame.body)) {
        await request("/r/SyncStatus/ackDiff", [stateFrame.body]).catch(() => null);
      }
      const conversations = Array.isArray(conversationFrame.body?.userConvs) ? conversationFrame.body.userConvs.filter(isRecord) : [];
      const messagePages = [];
      for (const conversation of conversations.slice(0, 10)) {
        const cid = conversationCid(conversation);
        if (!cid) continue;
        try {
          const frame = await request("/r/MessageManager/listUserMessages", [cid, false, Number.MAX_SAFE_INTEGER, 50, false]);
          const models = Array.isArray(frame.body?.userMessageModels) ? frame.body.userMessageModels.filter(isRecord) : [];
          messagePages.push({
            status: frame.code || null,
            bodyKeys: keys(frame.body),
            count: models.length,
            hasMore: frame.body?.hasMore === true,
            nextCursorType: frame.body?.nextCursor == null ? null : typeof frame.body.nextCursor,
            samples: summarizeMessages(models)
          });
        } catch (error) {
          messagePages.push({ error: error instanceof Error ? error.message : String(error) });
        }
      }
      socket.close();

      const contacts = [];
      for (const conversation of conversations) {
        const custom = parseCustom(conversation);
        const buyerAccountId =
          firstString(custom, ["toAccIdE", "buyerAccountId", "contactAccountIdEncrypt"]) ||
          firstString(conversation, ["buyerAccountId", "contactAccountIdEncrypt", "contactAccountId"]);
        const buyerLoginId = firstString(conversation, ["buyerLoginId", "contactLoginId", "loginId"]);
        if (buyerAccountId && !contacts.some((item) => item.buyerAccountId === buyerAccountId)) {
          contacts.push(buyerLoginId ? { buyerAccountId, buyerLoginId } : { buyerAccountId });
        }
      }
      result.lwp = {
        registerCode: register.code || null,
        registerHeaderKeys: keys(register.headers),
        stateBodyKeys: keys(stateFrame.body),
        conversationStatus: conversationFrame.code || null,
        conversationCount: conversations.length,
        conversationHasMore: conversationFrame.body?.hasMore === true,
        conversationNextCursorType: conversationFrame.body?.nextCursor == null ? null : typeof conversationFrame.body.nextCursor,
        conversationSamples: conversations.slice(0, 5).map((conversation) => ({
          topKeys: keys(conversation),
          wrapperKeys: keys(conversation.singleChatUserConversation),
          singleChatConversationKeys: keys(conversation.singleChatUserConversation?.singleChatConversation),
          customKeys: keys(parseCustom(conversation)),
          hasCid: !!conversationCid(conversation),
          lastMessageKeys: keys(conversation.singleChatUserConversation?.lastMessage),
          lastMessageInnerKeys: keys(conversation.singleChatUserConversation?.lastMessage?.message)
        })),
        messageRequestedConversations: messagePages.length,
        messageTotal: messagePages.reduce((total, page) => total + (page.count || 0), 0),
        messagePages,
        profileContactCount: contacts.length,
        profileContactSamples: contacts.slice(0, 5).map((contact) => ({
          hasBuyerAccountId: !!contact.buyerAccountId,
          hasBuyerLoginId: !!contact.buyerLoginId
        }))
      };

      if (contacts.length) {
        const profiles = await requestPageBridge("get-onetalk-customer-profiles", { contacts: contacts.slice(0, 10) }, 30_000);
        const items = Array.isArray(profiles.profiles) ? profiles.profiles.filter(isRecord) : [];
        result.profiles = {
          ok: profiles.ok === true,
          error: profiles.ok === true ? undefined : profiles.error,
          count: items.length,
          topKeys: [...new Set(items.flatMap(keys))].sort(),
          samples: items.slice(0, 5).map((profile) => {
            const buyerInfo = firstValue(profile, ["data.data.buyerInfo", "data.buyerInfo", "buyerInfo"]);
            return {
              topKeys: keys(profile),
              buyerInfoKeys: keys(buyerInfo),
              hasFirstName: !!buyerInfo?.firstName,
              hasLastName: !!buyerInfo?.lastName,
              hasCompanyName: !!buyerInfo?.companyName,
              hasCountry: !!buyerInfo?.country,
              hasEncryptAccountId: !!buyerInfo?.encryptAccountId
            };
          })
        };
      }
      result.ok = true;
      finish(result);
      return;
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
