import { Download, RefreshCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ConversationListItem, CustomerInfoResponse, MessageItem } from "@wangwang/shared";
import { exportMessages, fetchConversations, fetchCustomerInfo, fetchMessages } from "./api";

export function App() {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfoResponse | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [status, setStatus] = useState("准备就绪");
  const [loading, setLoading] = useState(false);

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) || null,
    [conversations, selectedId]
  );

  useEffect(() => {
    void loadConversations(false);
  }, []);

  async function loadConversations(refresh: boolean) {
    setLoading(true);
    setStatus(refresh ? "正在刷新缓存会话..." : "正在读取缓存会话...");
    try {
      const data = await fetchConversations(refresh);
      setConversations(data.conversations);
      const firstId = data.conversations[0]?.id || "";
      setSelectedId((current) => current || firstId);
      setStatus(`读取到 ${data.conversations.length} 个缓存会话`);
      if (firstId && !selectedId) {
        await loadConversationBundle(firstId);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }

  async function loadConversationBundle(conversationId: string) {
    setMessages([]);
    setCustomerInfo(null);
    setNextBefore(null);
    await Promise.all([loadMessages(conversationId, null, true), loadCustomerInfo(conversationId)]);
  }

  async function loadCustomerInfo(conversationId: string) {
    try {
      const data = await fetchCustomerInfo(conversationId);
      setCustomerInfo(data);
    } catch {
      setCustomerInfo(null);
    }
  }

  async function loadMessages(conversationId: string, before: number | null, replace: boolean) {
    setLoading(true);
    setStatus(before ? "正在加载更早消息..." : "正在加载消息...");
    try {
      const data = await fetchMessages(conversationId, before, 50);
      setMessages((current) => {
        const next = replace ? data.messages : [...data.messages, ...current];
        return dedupeMessages(next).sort((a, b) => (a.sendTime || 0) - (b.sendTime || 0));
      });
      setNextBefore(data.nextBefore);
      setStatus(`本页 ${data.page.count} 条，接口 code=${data.page.code ?? "unknown"}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function selectConversation(id: string) {
    setSelectedId(id);
    await loadConversationBundle(id);
  }

  async function handleExport() {
    setLoading(true);
    setStatus("正在导出...");
    try {
      const result = await exportMessages({ maxPages: 20, pageSize: 50 });
      setStatus(`导出 ${result.exportedMessageCount} 条消息：${result.output}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "导出失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="toolbar">
          <div>
            <h1>旺旺本机查看器</h1>
            <p>缓存会话与消息导出</p>
          </div>
          <button aria-label="刷新会话" onClick={() => void loadConversations(true)} disabled={loading}>
            <RefreshCcw size={18} />
          </button>
        </div>
        <div className="conversation-list">
          {conversations.map((conversation) => (
            <button
              className={conversation.id === selectedId ? "conversation active" : "conversation"}
              key={conversation.id}
              onClick={() => void selectConversation(conversation.id)}
            >
              <span className="conversation-title">{conversation.displayName}</span>
              <span className="conversation-preview">{conversation.lastMessagePreview || "暂无预览"}</span>
              <span className="conversation-meta">{formatTime(conversation.lastMessageTime)}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="thread">
        <header className="thread-header">
          <div>
            <h2>{selected?.displayName || "请选择会话"}</h2>
            <p>{status}</p>
          </div>
          <button onClick={() => void handleExport()} disabled={loading || conversations.length === 0}>
            <Download size={18} />
            导出
          </button>
        </header>
        <div className="message-actions">
          <button
            disabled={loading || !selectedId || !nextBefore}
            onClick={() => selectedId && void loadMessages(selectedId, nextBefore, false)}
          >
            加载更早消息
          </button>
        </div>
        <div className="message-list">
          {messages.map((message) => (
            <article className={`message ${message.direction}`} key={message.id}>
              <div className="message-bubble">
                <div className="message-content">{message.content || renderNonText(message)}</div>
                <time>{formatTime(message.sendTime || null)}</time>
              </div>
            </article>
          ))}
          {!messages.length && <div className="empty">没有消息，或当前会话接口返回为空。</div>}
        </div>
      </section>

      <CustomerPanel info={customerInfo} selected={selected} />
    </main>
  );
}

function CustomerPanel({ info, selected }: { info: CustomerInfoResponse | null; selected: ConversationListItem | null }) {
  const summary = info?.chatSummary;
  const profile = info?.mtopProfile;
  const account = info?.accountTokenProfile;
  const contact = info?.contactExtInfo;
  return (
    <aside className="customer-panel">
      <div className="customer-tabs">
        <span className="active">客户</span>
        <span>订单</span>
        <span>物流报价</span>
      </div>
      <section className="customer-section">
        <h2>{info?.identity.displayName || selected?.displayName || "未选择客户"}</h2>
        <InfoRow label="公司名称" value={contact?.companyName} />
        <InfoRow label="买家 ID" value={info?.identity.buyerLoginId || account?.targetLoginId} />
        <InfoRow label="国家/地区" value={contact?.country || profile?.countryCode} />
        <InfoRow label="联系人" value={formatContactName(contact?.firstName, contact?.lastName)} />
        <InfoRow label="加入年限" value={profile?.joiningYears != null ? `${profile.joiningYears} 年` : ""} />
        <InfoRow label="最近联系" value={profile?.recentContact == null ? "" : profile.recentContact ? "是" : "否"} />
        <InfoRow label="潜力分" value={profile?.potentialScore} />
      </section>

      <section className="customer-section">
        <h3>客户行为数据</h3>
        <div className="metric-grid">
          <Metric label="产品卡片" value={summary?.productCardNum} />
          <Metric label="询盘卡片" value={summary?.inquiryCardNum} />
          <Metric label="报价卡片" value={summary?.quotationCardNum} />
          <Metric label="待付款订单" value={summary?.unPayOrderNum} />
          <Metric label="待发货订单" value={summary?.unshippedOrderNum} />
          <Metric label="待确认收货" value={summary?.unConfirmShipmentOrderNum} />
        </div>
      </section>

      <section className="customer-section muted">
        <h3>完整客户详情</h3>
        <p>{info?.detailStatus.available ? "已获取" : "alicrm 客户详情接口需要完整浏览器运行态，当前先显示可稳定匹配的数据。"}</p>
        <div className="source-list">
          {(info?.matchedSources || []).map((source) => (
            <span key={source}>{source}</span>
          ))}
        </div>
      </section>
    </aside>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | number | boolean | null }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value === undefined || value === null || value === "" ? "-" : String(value)}</strong>
    </div>
  );
}

function Metric({ label, value }: { label: string; value?: number }) {
  return (
    <div className="metric">
      <strong>{value ?? "-"}</strong>
      <span>{label}</span>
    </div>
  );
}

function dedupeMessages(messages: MessageItem[]): MessageItem[] {
  return Array.from(new Map(messages.map((message) => [message.id, message])).values());
}

function formatTime(value: number | null): string {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function formatContactName(firstName?: string, lastName?: string): string {
  return [firstName, lastName].filter(Boolean).join(" ");
}

function renderNonText(message: MessageItem): string {
  return `[${message.messageType ?? "message"} / ${message.subType ?? "unknown"}]`;
}
