import { installWhatsAppMessageTap } from "./whatsapp-message-tap.js";
import { resolveWhatsAppRuntime } from "./whatsapp-runtime.js";

const EXTENSION_SOURCE = "tradebridge-extension";
const PAGE_SOURCE = "tradebridge-whatsapp-web-page";

installWhatsAppMessageTap(window);

window.addEventListener("message", (event) => {
  if (event.source !== window || !isRecord(event.data)) return;
  if (event.data.source !== EXTENSION_SOURCE) return;
  if (event.data.type === "send-whatsapp-web-message") {
    void sendMessage(event.data);
  }
});

async function sendMessage(request: Record<string, unknown>): Promise<void> {
  const requestId = typeof request.requestId === "string" ? request.requestId : "";
  const message = isRecord(request.message) ? request.message : {};
  const chatId = typeof message.externalConversationId === "string" ? message.externalConversationId : "";
  const text = typeof message.content === "string" ? message.content : "";
  const runtime = resolveWhatsAppRuntime(window);

  if (!runtime) {
    postResult(requestId, { ok: false, error: "whatsapp_web_runtime_unavailable" });
    return;
  }
  if (!chatId || !text) {
    postResult(requestId, { ok: false, error: "whatsapp_web_send_payload_invalid" });
    return;
  }
  if (!runtime.sendText) {
    postResult(requestId, { ok: false, error: "whatsapp_web_send_function_unavailable" });
    return;
  }

  try {
    const result = await runtime.sendText({ chatId, text });
    postResult(requestId, {
      ok: true,
      externalMessageId:
        typeof result === "string" ? result : result && typeof result.id === "string" ? result.id : undefined
    });
  } catch (error) {
    postResult(requestId, { ok: false, error: error instanceof Error ? error.message : "whatsapp_web_send_failed" });
  }
}

function postResult(requestId: string, payload: Record<string, unknown>): void {
  window.postMessage(
    {
      source: PAGE_SOURCE,
      type: "send-whatsapp-web-message-result",
      requestId,
      ...payload
    },
    window.location.origin
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
