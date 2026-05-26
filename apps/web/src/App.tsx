import {
  CheckCircle2,
  Clock3,
  KeyRound,
  LogIn,
  LogOut,
  MessageSquareText,
  RefreshCcw,
  Search,
  Send,
  StickyNote,
  Tag,
  UserRound
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createInternalApiClient } from "./api";
import type { WorkspaceState } from "./types";
import {
  addTagToSelectedCustomer,
  createInitialWorkspaceState,
  createNoteForSelectedCustomer,
  createTaskForSelectedCustomer,
  loadCustomerList,
  selectConversation,
  selectCustomer
} from "./workspace-state";

const DEFAULT_ORG_ID = "org_internal";
const STORAGE_KEYS = {
  token: "wangwang.internalToken",
  orgId: "wangwang.orgId",
  serverBaseUrl: "wangwang.serverBaseUrl"
};

export function App() {
  const [serverBaseUrl, setServerBaseUrl] = useState(() => readStorage(STORAGE_KEYS.serverBaseUrl, ""));
  const [token, setToken] = useState(() => readStorage(STORAGE_KEYS.token, ""));
  const [developerToken, setDeveloperToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgId, setOrgId] = useState(() => readStorage(STORAGE_KEYS.orgId, DEFAULT_ORG_ID));
  const [state, setState] = useState<WorkspaceState>(() => createInitialWorkspaceState({ orgId }));
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  const apiClient = useMemo(
    () => createInternalApiClient({ baseUrl: serverBaseUrl, token }),
    [serverBaseUrl, token]
  );

  useEffect(() => {
    writeStorage(STORAGE_KEYS.serverBaseUrl, serverBaseUrl);
  }, [serverBaseUrl]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.token, token);
  }, [token]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.orgId, orgId);
    setState(createInitialWorkspaceState({ orgId }));
  }, [orgId]);

  useEffect(() => {
    if (!token.trim()) return;
    let cancelled = false;
    setLoading(true);
    void loadCustomerList(createInitialWorkspaceState({ orgId }), createInternalApiClient({ baseUrl: serverBaseUrl, token }))
      .then((nextState) => {
        if (!cancelled) setState(nextState);
      })
      .catch((error) => {
        if (!cancelled) {
          setState((current) => ({ ...current, status: "读取失败", error: errorMessage(error) }));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, serverBaseUrl, token]);

  async function runWorkflow(workflow: (current: WorkspaceState) => Promise<WorkspaceState>) {
    if (!token.trim()) {
      setState((current) => ({ ...current, status: "等待开发 Token", error: "internal_token_required" }));
      return;
    }
    setLoading(true);
    try {
      const nextState = await workflow(state);
      setState(nextState);
    } catch (error) {
      setState((current) => ({ ...current, status: "操作失败", error: errorMessage(error) }));
    } finally {
      setLoading(false);
    }
  }

  async function runLogin(login: () => Promise<string>) {
    setLoading(true);
    setAuthError("");
    try {
      const nextToken = await login();
      setToken(nextToken);
    } catch (error) {
      setAuthError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  function handlePasswordLogin() {
    if (!email.trim() || !password.trim()) {
      setAuthError("login_credentials_required");
      return;
    }
    void runLogin(async () => {
      const result = await createInternalApiClient({ baseUrl: serverBaseUrl, token: "" }).login({
        orgId,
        email: email.trim(),
        password
      });
      return result.token;
    });
  }

  function handleDeveloperTokenLogin() {
    const nextToken = developerToken.trim();
    if (!nextToken) {
      setAuthError("internal_token_required");
      return;
    }
    setAuthError("");
    setToken(nextToken);
  }

  function handleLogout() {
    setToken("");
    setState(createInitialWorkspaceState({ orgId }));
  }

  if (!token.trim()) {
    return (
      <LoginView
        orgId={orgId}
        serverBaseUrl={serverBaseUrl}
        email={email}
        password={password}
        developerToken={developerToken}
        loading={loading}
        error={authError}
        onOrgIdChange={setOrgId}
        onServerBaseUrlChange={setServerBaseUrl}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onDeveloperTokenChange={setDeveloperToken}
        onPasswordLogin={handlePasswordLogin}
        onDeveloperTokenLogin={handleDeveloperTokenLogin}
      />
    );
  }

  return (
    <WorkspaceView
      state={state}
      serverBaseUrl={serverBaseUrl}
      orgId={orgId}
      loading={loading}
      onServerBaseUrlChange={setServerBaseUrl}
      onOrgIdChange={setOrgId}
      onLogout={handleLogout}
      onRefresh={() => void runWorkflow(() => loadCustomerList(createInitialWorkspaceState({ orgId }), apiClient))}
      onSelectCustomer={(customerId) => void runWorkflow((current) => selectCustomer(current, apiClient, customerId))}
      onSelectConversation={(conversationId) =>
        void runWorkflow((current) => selectConversation(current, apiClient, conversationId))
      }
      onAddNote={(body) => void runWorkflow((current) => createNoteForSelectedCustomer(current, apiClient, body))}
      onAddTag={(tagText) => void runWorkflow((current) => addTagToSelectedCustomer(current, apiClient, tagText))}
      onAddTask={(title) => void runWorkflow((current) => createTaskForSelectedCustomer(current, apiClient, title))}
    />
  );
}

interface LoginViewProps {
  orgId: string;
  serverBaseUrl: string;
  email: string;
  password: string;
  developerToken: string;
  loading: boolean;
  error: string;
  onOrgIdChange(value: string): void;
  onServerBaseUrlChange(value: string): void;
  onEmailChange(value: string): void;
  onPasswordChange(value: string): void;
  onDeveloperTokenChange(value: string): void;
  onPasswordLogin(): void;
  onDeveloperTokenLogin(): void;
}

export function LoginView(props: LoginViewProps) {
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="auth-brand">
          <span className="brand-mark">TB</span>
          <div>
            <h1>登录 TradeBridge</h1>
            <p>内部销售工作台</p>
          </div>
        </div>

        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            props.onPasswordLogin();
          }}
        >
          <label>
            Org
            <input value={props.orgId} onChange={(event) => props.onOrgIdChange(event.target.value)} />
          </label>
          <label>
            API
            <input
              placeholder="/internal 代理"
              value={props.serverBaseUrl}
              onChange={(event) => props.onServerBaseUrlChange(event.target.value)}
            />
          </label>
          <label>
            邮箱
            <input
              type="email"
              value={props.email}
              onChange={(event) => props.onEmailChange(event.target.value)}
            />
          </label>
          <label>
            密码
            <input
              type="password"
              value={props.password}
              onChange={(event) => props.onPasswordChange(event.target.value)}
            />
          </label>
          <button type="submit" disabled={props.loading}>
            <LogIn size={16} />
            <span>登录</span>
          </button>
        </form>

        <div className="auth-divider">
          <span>或</span>
        </div>

        <form
          className="auth-form compact"
          onSubmit={(event) => {
            event.preventDefault();
            props.onDeveloperTokenLogin();
          }}
        >
          <label>
            开发 Token
            <input
              type="password"
              value={props.developerToken}
              onChange={(event) => props.onDeveloperTokenChange(event.target.value)}
            />
          </label>
          <button type="submit" disabled={props.loading}>
            <KeyRound size={16} />
            <span>进入</span>
          </button>
        </form>

        {props.error && <p className="auth-error">{props.error}</p>}
      </section>
    </main>
  );
}

interface WorkspaceViewProps {
  state: WorkspaceState;
  serverBaseUrl: string;
  orgId: string;
  loading: boolean;
  onServerBaseUrlChange(value: string): void;
  onOrgIdChange(value: string): void;
  onLogout?(): void;
  onRefresh(): void;
  onSelectCustomer(externalCustomerId: string): void;
  onSelectConversation(externalConversationId: string): void;
  onAddNote(body: string): void;
  onAddTag(tag: string): void;
  onAddTask(title: string): void;
}

export function WorkspaceView(props: WorkspaceViewProps) {
  const [customerFilter, setCustomerFilter] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [taskDraft, setTaskDraft] = useState("");
  const selectedCustomer = props.state.customers.find(
    (customer) => customer.externalCustomerId === props.state.selectedCustomerId
  );
  const filteredCustomers = props.state.customers.filter((customer) => {
    const haystack = [customer.displayName, customer.loginId, customer.externalCustomerId, customer.country]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(customerFilter.trim().toLowerCase());
  });
  const selectedConversation = props.state.conversations.find(
    (conversation) => conversation.externalConversationId === props.state.selectedConversationId
  );

  return (
    <main className="crm-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark">TB</span>
          <div>
            <h1>TradeBridge 销售工作台</h1>
            <p>{props.state.status}</p>
          </div>
        </div>
        <div className="connection-bar" aria-label="内部接口连接">
          <label>
            Org
            <input value={props.orgId} onChange={(event) => props.onOrgIdChange(event.target.value)} />
          </label>
          <label>
            API
            <input
              placeholder="/internal 代理"
              value={props.serverBaseUrl}
              onChange={(event) => props.onServerBaseUrlChange(event.target.value)}
            />
          </label>
          <button className="icon-button primary" type="button" onClick={props.onRefresh} disabled={props.loading}>
            <RefreshCcw size={17} />
            <span>刷新</span>
          </button>
          {props.onLogout && (
            <button className="icon-button" type="button" onClick={props.onLogout}>
              <LogOut size={17} />
              <span>退出</span>
            </button>
          )}
        </div>
      </header>

      <section className="workspace-grid">
        <aside className="customer-list-pane">
          <div className="pane-heading">
            <div>
              <h2>客户</h2>
              <p>{props.state.customers.length} 个</p>
            </div>
            <UserRound size={18} />
          </div>
          <label className="search-box">
            <Search size={16} />
            <input
              value={customerFilter}
              placeholder="搜索客户"
              onChange={(event) => setCustomerFilter(event.target.value)}
            />
          </label>
          <div className="customer-list">
            {filteredCustomers.map((customer) => (
              <button
                type="button"
                className={customer.externalCustomerId === props.state.selectedCustomerId ? "customer active" : "customer"}
                key={customer.externalCustomerId}
                onClick={() => props.onSelectCustomer(customer.externalCustomerId)}
              >
                <span className="customer-name">{customer.displayName || customer.loginId || customer.externalCustomerId}</span>
                <span className="customer-meta">
                  {customer.country || "未知地区"} · {customer.stage || "未分层"}
                </span>
                <span className="customer-id">{customer.loginId || customer.externalCustomerId}</span>
              </button>
            ))}
            {!filteredCustomers.length && <div className="empty-state">暂无客户</div>}
          </div>
        </aside>

        <section className="conversation-pane">
          <header className="customer-summary">
            <div>
              <h2>{selectedCustomer?.displayName || selectedCustomer?.loginId || "未选择客户"}</h2>
              <p>{selectedCustomer ? customerSubtitle(selectedCustomer) : props.state.error || "等待同步数据"}</p>
            </div>
            <div className="summary-metrics">
              <Metric label="会话" value={props.state.conversations.length} />
              <Metric label="消息" value={props.state.messages.length} />
              <Metric label="任务" value={props.state.tasks.filter((task) => task.status !== "done").length} />
            </div>
          </header>

          <div className="conversation-strip">
            {props.state.conversations.map((conversation) => (
              <button
                type="button"
                key={conversation.externalConversationId}
                className={
                  conversation.externalConversationId === props.state.selectedConversationId
                    ? "conversation-chip active"
                    : "conversation-chip"
                }
                onClick={() => props.onSelectConversation(conversation.externalConversationId)}
              >
                <MessageSquareText size={15} />
                <span>{conversation.externalConversationId}</span>
                <time>{formatDateTime(conversation.lastMessageAt)}</time>
              </button>
            ))}
            {!props.state.conversations.length && <span className="strip-empty">没有会话</span>}
          </div>

          <div className="timeline" aria-label={selectedConversation?.externalConversationId || "会话消息"}>
            {props.state.messages.map((message) => (
              <article className={`timeline-message ${message.direction}`} key={message.uniqueKey}>
                <div className="message-bubble">
                  <p>{message.content || renderNonText(message.messageType)}</p>
                  <time>{formatDateTime(message.sentAt)}</time>
                </div>
              </article>
            ))}
            {!props.state.messages.length && <div className="empty-state large">暂无消息</div>}
          </div>
        </section>

        <aside className="collaboration-pane">
          <section className="detail-section">
            <div className="section-heading">
              <h2>客户档案</h2>
              <CheckCircle2 size={17} />
            </div>
            <InfoRow label="显示名称" value={selectedCustomer?.displayName} />
            <InfoRow label="登录 ID" value={selectedCustomer?.loginId} />
            <InfoRow label="客户外部 ID" value={selectedCustomer?.externalCustomerId} />
            <InfoRow label="Seller" value={selectedCustomer?.sellerAccountExternalId} />
            <InfoRow label="国家/地区" value={selectedCustomer?.country} />
            <InfoRow label="客户阶段" value={selectedCustomer?.stage} />
            <InfoRow label="数据负责人" value={selectedCustomer?.ownerUserId} />
            <InfoRow label="分配给" value={props.state.assignment?.assignedToUserId} />
            <InfoRow label="分配人" value={props.state.assignment?.assignedByUserId} />
            <InfoRow label="分配时间" value={formatDateTime(props.state.assignment?.assignedAt)} />
          </section>

          <section className="detail-section">
            <div className="section-heading">
              <h2>当前会话</h2>
              <MessageSquareText size={17} />
            </div>
            <InfoRow label="会话 ID" value={selectedConversation?.externalConversationId} />
            <InfoRow label="客户 ID" value={selectedConversation?.externalCustomerId} />
            <InfoRow label="最近消息" value={formatDateTime(selectedConversation?.lastMessageAt)} />
            <InfoRow label="消息数量" value={props.state.messages.length} />
          </section>

          <section className="detail-section">
            <div className="section-heading">
              <h2>标签</h2>
              <Tag size={17} />
            </div>
            <form
              className="inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                props.onAddTag(tagDraft);
                setTagDraft("");
              }}
            >
              <input value={tagDraft} placeholder="新增标签" onChange={(event) => setTagDraft(event.target.value)} />
              <button type="submit" aria-label="添加标签">
                <Send size={15} />
              </button>
            </form>
            <div className="tag-list">
              {props.state.tags.map((item) => (
                <span key={item.id}>{item.tag}</span>
              ))}
              {!props.state.tags.length && <span className="muted-text">暂无标签</span>}
            </div>
          </section>

          <section className="detail-section">
            <div className="section-heading">
              <h2>笔记</h2>
              <StickyNote size={17} />
            </div>
            <form
              className="stack-form"
              onSubmit={(event) => {
                event.preventDefault();
                props.onAddNote(noteDraft);
                setNoteDraft("");
              }}
            >
              <textarea value={noteDraft} placeholder="新增笔记" onChange={(event) => setNoteDraft(event.target.value)} />
              <button type="submit">
                <Send size={15} />
                <span>保存</span>
              </button>
            </form>
            <div className="note-list">
              {props.state.notes.map((note) => (
                <article className="note-item" key={note.id}>
                  <p>{note.body}</p>
                  <time>{formatDateTime(note.createdAt)}</time>
                </article>
              ))}
              {!props.state.notes.length && <div className="empty-state compact">暂无笔记</div>}
            </div>
          </section>

          <section className="detail-section">
            <div className="section-heading">
              <h2>任务</h2>
              <Clock3 size={17} />
            </div>
            <form
              className="inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                props.onAddTask(taskDraft);
                setTaskDraft("");
              }}
            >
              <input value={taskDraft} placeholder="新增任务" onChange={(event) => setTaskDraft(event.target.value)} />
              <button type="submit" aria-label="添加任务">
                <Send size={15} />
              </button>
            </form>
            <div className="task-list">
              {props.state.tasks.map((task) => (
                <article className="task-item" key={task.id}>
                  <span>{task.title}</span>
                  <strong>{task.status}</strong>
                  {task.assignedToUserId && <small>{task.assignedToUserId}</small>}
                  {task.dueAt && <time>{formatDateTime(task.dueAt)}</time>}
                </article>
              ))}
              {!props.state.tasks.length && <div className="empty-state compact">暂无任务</div>}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value === undefined || value === null || value === "" ? "-" : String(value)}</strong>
    </div>
  );
}

function customerSubtitle(customer: NonNullable<WorkspaceState["customers"][number]>): string {
  return [customer.country, customer.stage, customer.loginId].filter(Boolean).join(" · ") || customer.externalCustomerId;
}

function renderNonText(messageType?: string | number): string {
  return `[${messageType ?? "message"}]`;
}

function formatDateTime(value?: string): string {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown_error";
}

function readStorage(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return window.localStorage.getItem(key) || fallback;
}

function writeStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value);
}
