import {
  Ban,
  CheckCircle2,
  Clock3,
  LogIn,
  LogOut,
  MessageSquareText,
  RefreshCcw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  StickyNote,
  Tag,
  UserPlus,
  UserRound
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createInternalApiClient } from "./api";
import type {
  CreateInternalUserInput,
  DashboardState,
  InternalRole,
  InternalUser
} from "./types";
import {
  addTagToSelectedCustomer,
  createInitialDashboardState,
  createNoteForSelectedCustomer,
  createOutboundMessageForSelectedConversation,
  createTaskForSelectedCustomer,
  loadCustomerList,
  selectConversation,
  selectCustomer
} from "./dashboard-state";

const STORAGE_KEYS = {
  session: "wangwang.internalSession",
  legacyToken: "wangwang.internalToken",
  legacyCurrentUser: "wangwang.currentUser",
  serverBaseUrl: "wangwang.serverBaseUrl"
};

const ROLE_OPTIONS: InternalRole[] = ["admin", "supervisor", "sales"];

interface LoginSessionSnapshot {
  token: string;
  user: InternalUser;
  serverBaseUrl: string;
}

export function App() {
  const initialServerBaseUrl = readStorage(STORAGE_KEYS.serverBaseUrl, "");
  const [serverBaseUrl, setServerBaseUrl] = useState(initialServerBaseUrl);
  const [session, setSession] = useState<LoginSessionSnapshot | null>(() =>
    readSessionStorage({ serverBaseUrl: initialServerBaseUrl })
  );
  const [setupMode, setSetupMode] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [advancedConnectionOpen, setAdvancedConnectionOpen] = useState(false);
  const [state, setState] = useState<DashboardState>(() => createInitialDashboardState());
  const [users, setUsers] = useState<InternalUser[]>([]);
  const [userManagementMode, setUserManagementMode] = useState(false);
  const [userManagementError, setUserManagementError] = useState("");
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const token = session?.token || "";
  const currentUser = session?.user || null;
  const isCurrentAdmin = Boolean(currentUser?.roles.includes("admin"));

  const apiClient = useMemo(
    () => createInternalApiClient({ baseUrl: serverBaseUrl, token }),
    [serverBaseUrl, token]
  );

  useEffect(() => {
    writeStorage(STORAGE_KEYS.serverBaseUrl, serverBaseUrl);
  }, [serverBaseUrl]);

  useEffect(() => {
    writeSessionStorage(session);
  }, [session]);

  useEffect(() => {
    if (!token.trim()) return;
    let cancelled = false;
    setLoading(true);
    void loadCustomerList(createInitialDashboardState(), createInternalApiClient({ baseUrl: serverBaseUrl, token }))
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
  }, [serverBaseUrl, token]);

  async function runWorkflow(workflow: (current: DashboardState) => Promise<DashboardState>) {
    if (!token.trim()) {
      setState((current) => ({ ...current, status: "等待登录", error: "internal_token_required" }));
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

  async function runLogin(login: () => Promise<{ token: string; user: InternalUser }>) {
    setLoading(true);
    setAuthError("");
    try {
      const result = await login();
      setSession({ token: result.token, user: result.user, serverBaseUrl });
      setSetupMode(false);
      setUserManagementMode(false);
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
        email: email.trim(),
        password
      });
      return { token: result.token, user: result.user };
    });
  }

  function handleSetupAdmin() {
    if (!email.trim() || !displayName.trim() || !password.trim()) {
      setAuthError("setup_admin_fields_required");
      return;
    }
    setLoading(true);
    setAuthError("");
    void (async () => {
      const client = createInternalApiClient({ baseUrl: serverBaseUrl, token: "" });
      try {
        await client.setupAdmin({
          email: email.trim(),
          displayName: displayName.trim(),
          password
        });
      } catch (error) {
        setAuthError(errorMessage(error));
        setLoading(false);
        return;
      }

      try {
        const result = await client.login({ email: email.trim(), password });
        setSession({ token: result.token, user: result.user, serverBaseUrl });
        setSetupMode(false);
        setUserManagementMode(false);
      } catch (error) {
        setSetupMode(false);
        setAuthError(`管理员已创建，请使用邮箱密码登录。登录错误：${errorMessage(error)}`);
      } finally {
        setLoading(false);
      }
    })();
  }

  function handleLogout() {
    if (token.trim()) void apiClient.logout().catch(() => undefined);
    clearLocalSession();
  }

  function clearLocalSession() {
    setSession(null);
    setUserManagementMode(false);
    setUsers([]);
    setUserManagementError("");
    setState(createInitialDashboardState());
  }

  function handleServerBaseUrlChange(value: string) {
    setServerBaseUrl(value);
    setAuthError("");
    clearLocalSession();
  }

  async function runUserManagement(action: () => Promise<void>): Promise<boolean> {
    setLoading(true);
    setUserManagementError("");
    try {
      await action();
      setUsers(await apiClient.listInternalUsers());
      return true;
    } catch (error) {
      setUserManagementError(errorMessage(error));
      return false;
    } finally {
      setLoading(false);
    }
  }

  function handleOpenUserManagement() {
    setUserManagementMode(true);
    void runUserManagement(async () => undefined);
  }

  function handleCreateUser(input: CreateInternalUserInput): Promise<boolean> {
    return runUserManagement(async () => {
      await apiClient.createInternalUser(input);
    });
  }

  function handleDisableUser(userId: string) {
    void runUserManagement(async () => {
      await apiClient.disableInternalUser({ userId });
    });
  }

  function handleResetUserPassword(userId: string, password: string): Promise<boolean> {
    return runUserManagement(async () => {
      await apiClient.resetInternalUserPassword({ userId, password });
    });
  }

  if (!token.trim()) {
    if (setupMode) {
      return (
        <SetupAdminView
          serverBaseUrl={serverBaseUrl}
          email={email}
          displayName={displayName}
          password={password}
          loading={loading}
          error={authError}
          onServerBaseUrlChange={handleServerBaseUrlChange}
          onEmailChange={setEmail}
          onDisplayNameChange={setDisplayName}
          onPasswordChange={setPassword}
          onSetupAdmin={handleSetupAdmin}
          onLoginMode={() => {
            setAuthError("");
            setSetupMode(false);
          }}
        />
      );
    }

    return (
      <LoginView
        serverBaseUrl={serverBaseUrl}
        email={email}
        password={password}
        loading={loading}
        error={authError}
        advancedOpen={advancedConnectionOpen}
        onAdvancedOpenChange={setAdvancedConnectionOpen}
        onServerBaseUrlChange={handleServerBaseUrlChange}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onPasswordLogin={handlePasswordLogin}
        onSetupMode={() => {
          setAuthError("");
          setSetupMode(true);
        }}
      />
    );
  }

  if (userManagementMode && isCurrentAdmin) {
    return (
      <UserManagementView
        users={users}
        loading={loading}
        error={userManagementError}
        onBack={() => setUserManagementMode(false)}
        onRefreshUsers={() => void runUserManagement(async () => undefined)}
        onCreateUser={handleCreateUser}
        onDisableUser={handleDisableUser}
        onResetPassword={handleResetUserPassword}
      />
    );
  }

  return (
    <DashboardView
      state={state}
      serverBaseUrl={serverBaseUrl}
      currentUser={currentUser}
      loading={loading}
      onServerBaseUrlChange={handleServerBaseUrlChange}
      onLogout={handleLogout}
      onOpenUserManagement={isCurrentAdmin ? handleOpenUserManagement : undefined}
      onRefresh={() => void runWorkflow(() => loadCustomerList(createInitialDashboardState(), apiClient))}
      onSelectCustomer={(customerId) => void runWorkflow((current) => selectCustomer(current, apiClient, customerId))}
      onSelectConversation={(conversationId) =>
        void runWorkflow((current) => selectConversation(current, apiClient, conversationId))
      }
      onAddNote={(body) => void runWorkflow((current) => createNoteForSelectedCustomer(current, apiClient, body))}
      onAddTag={(tagText) => void runWorkflow((current) => addTagToSelectedCustomer(current, apiClient, tagText))}
      onAddTask={(title) => void runWorkflow((current) => createTaskForSelectedCustomer(current, apiClient, title))}
      onSendMessage={(content) =>
        void runWorkflow((current) => createOutboundMessageForSelectedConversation(current, apiClient, content))
      }
    />
  );
}

interface LoginViewProps {
  serverBaseUrl: string;
  email: string;
  password: string;
  loading: boolean;
  error: string;
  advancedOpen: boolean;
  onAdvancedOpenChange(value: boolean): void;
  onServerBaseUrlChange(value: string): void;
  onEmailChange(value: string): void;
  onPasswordChange(value: string): void;
  onPasswordLogin(): void;
  onSetupMode(): void;
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
          <button
            className="text-button connection-toggle"
            type="button"
            onClick={() => props.onAdvancedOpenChange(!props.advancedOpen)}
          >
            <Settings2 size={16} />
            <span>连接设置</span>
          </button>
          {props.advancedOpen && (
            <label>
              API
              <input
                placeholder="/internal 代理"
                value={props.serverBaseUrl}
                onChange={(event) => props.onServerBaseUrlChange(event.target.value)}
              />
            </label>
          )}
          <button type="submit" disabled={props.loading}>
            <LogIn size={16} />
            <span>登录</span>
          </button>
        </form>

        <button className="text-button" type="button" onClick={props.onSetupMode}>
          <ShieldCheck size={16} />
          <span>初始化首个管理员</span>
        </button>

        {props.error && <p className="auth-error">{props.error}</p>}
      </section>
    </main>
  );
}

interface SetupAdminViewProps {
  serverBaseUrl: string;
  email: string;
  displayName: string;
  password: string;
  loading: boolean;
  error: string;
  onServerBaseUrlChange(value: string): void;
  onEmailChange(value: string): void;
  onDisplayNameChange(value: string): void;
  onPasswordChange(value: string): void;
  onSetupAdmin(): void;
  onLoginMode(): void;
}

export function SetupAdminView(props: SetupAdminViewProps) {
  return (
    <main className="auth-shell">
      <section className="auth-panel setup-panel">
        <div className="auth-brand">
          <span className="brand-mark">TB</span>
          <div>
            <h1>初始化首个管理员</h1>
            <p>为内部销售工作台创建第一个账号</p>
          </div>
        </div>

        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSetupAdmin();
          }}
        >
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
            <input type="email" value={props.email} onChange={(event) => props.onEmailChange(event.target.value)} />
          </label>
          <label>
            显示名称
            <input value={props.displayName} onChange={(event) => props.onDisplayNameChange(event.target.value)} />
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
            <ShieldCheck size={16} />
            <span>创建管理员</span>
          </button>
        </form>

        <button className="text-button" type="button" onClick={props.onLoginMode}>
          <LogIn size={16} />
          <span>返回登录</span>
        </button>

        {props.error && <p className="auth-error">{props.error}</p>}
      </section>
    </main>
  );
}

interface DashboardViewProps {
  state: DashboardState;
  serverBaseUrl: string;
  currentUser?: InternalUser | null;
  loading: boolean;
  onServerBaseUrlChange(value: string): void;
  onLogout?(): void;
  onOpenUserManagement?(): void;
  onRefresh(): void;
  onSelectCustomer(externalCustomerId: string): void;
  onSelectConversation(externalConversationId: string): void;
  onAddNote(body: string): void;
  onAddTag(tag: string): void;
  onAddTask(title: string): void;
  onSendMessage(content: string): void;
}

export function DashboardView(props: DashboardViewProps) {
  const [customerFilter, setCustomerFilter] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [taskDraft, setTaskDraft] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
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
            <p>
              {props.currentUser
                ? `${props.currentUser.displayName || props.currentUser.email} · ${props.state.status}`
                : props.state.status}
            </p>
          </div>
        </div>
        <div className="connection-bar" aria-label="内部接口连接">
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
          {props.onOpenUserManagement && (
            <button className="icon-button" type="button" onClick={props.onOpenUserManagement}>
              <UserRound size={17} />
              <span>用户</span>
            </button>
          )}
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
              <Metric label="待发" value={props.state.outboundMessages.filter((item) => item.status === "queued").length} />
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
            {props.state.outboundMessages.map((message) => (
              <article className={`timeline-message sent outbound ${message.status}`} key={`outbound-${message.id}`}>
                <div className="message-bubble">
                  <p>{message.content}</p>
                  <time>
                    {outboundStatusLabel(message.status)} · {formatDateTime(message.deliveredAt || message.createdAt)}
                  </time>
                  {message.errorMessage && <small>{message.errorMessage}</small>}
                </div>
              </article>
            ))}
            {!props.state.messages.length && !props.state.outboundMessages.length && (
              <div className="empty-state large">暂无消息</div>
            )}
          </div>

          <form
            className="reply-composer"
            onSubmit={(event) => {
              event.preventDefault();
              props.onSendMessage(replyDraft);
              setReplyDraft("");
            }}
          >
            <textarea
              aria-label="发送消息内容"
              value={replyDraft}
              placeholder="输入回复内容"
              onChange={(event) => setReplyDraft(event.target.value)}
            />
            <button
              type="submit"
              disabled={props.loading || !props.state.selectedConversationId || !replyDraft.trim()}
            >
              <Send size={16} />
              <span>发送到 OneTalk</span>
            </button>
          </form>
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

interface UserManagementViewProps {
  users: InternalUser[];
  loading: boolean;
  error: string;
  onBack(): void;
  onRefreshUsers(): void;
  onCreateUser(input: CreateInternalUserInput): Promise<boolean>;
  onDisableUser(userId: string): void;
  onResetPassword(userId: string, password: string): Promise<boolean>;
}

export function UserManagementView(props: UserManagementViewProps) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<InternalRole>("sales");
  const [resetDrafts, setResetDrafts] = useState<Record<string, string>>({});

  return (
    <main className="crm-shell admin-shell">
      <header className="topbar admin-topbar">
        <div className="brand-block">
          <span className="brand-mark">TB</span>
          <div>
            <h1>用户管理</h1>
            <p>{props.users.length} 个内部用户</p>
          </div>
        </div>
        <div className="admin-actions">
          <button className="icon-button primary" type="button" onClick={props.onRefreshUsers} disabled={props.loading}>
            <RefreshCcw size={17} />
            <span>刷新</span>
          </button>
          <button className="icon-button" type="button" onClick={props.onBack}>
            <LogIn size={17} />
            <span>返回工作台</span>
          </button>
        </div>
      </header>

      <section className="admin-panel">
        <form
          className="create-user-form"
          onSubmit={(event) => {
            event.preventDefault();
            void props
              .onCreateUser({
                email: email.trim(),
                displayName: displayName.trim(),
                password,
                roles: [role]
              })
              .then((success) => {
                if (!success) return;
                setEmail("");
                setDisplayName("");
                setPassword("");
                setRole("sales");
              });
          }}
        >
          <div className="panel-heading">
            <div>
              <h2>创建用户</h2>
              <p>管理员可创建内部销售、主管或管理员账号</p>
            </div>
            <UserPlus size={18} />
          </div>
          <label>
            邮箱
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            显示名称
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label>
            密码
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <label>
            角色
            <select value={role} onChange={(event) => setRole(event.target.value as InternalRole)}>
              {ROLE_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={props.loading || !email.trim() || !displayName.trim() || !password.trim()}>
            <UserPlus size={16} />
            <span>创建用户</span>
          </button>
        </form>

        <section className="user-table" aria-label="内部用户列表">
          <div className="user-row user-row-head">
            <span>邮箱</span>
            <span>名称</span>
            <span>角色</span>
            <span>状态</span>
            <span>操作</span>
          </div>
          {props.users.map((user) => {
            const resetPassword = resetDrafts[user.id] || "";
            return (
              <article className="user-row" key={user.id}>
                <strong>{user.email}</strong>
                <span>{user.displayName || "-"}</span>
                <span>{user.roles.join(", ")}</span>
                <span className={`status-pill ${user.status}`}>{user.status}</span>
                <div className="user-actions">
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => props.onDisableUser(user.id)}
                    disabled={props.loading || user.status === "disabled"}
                  >
                    <Ban size={15} />
                    <span>禁用</span>
                  </button>
                  <input
                    type="password"
                    placeholder="新密码"
                    value={resetPassword}
                    onChange={(event) =>
                      setResetDrafts((current) => ({ ...current, [user.id]: event.target.value }))
                    }
                  />
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => {
                      void props.onResetPassword(user.id, resetPassword).then((success) => {
                        if (!success) return;
                        setResetDrafts((current) => ({ ...current, [user.id]: "" }));
                      });
                    }}
                    disabled={props.loading || !resetPassword.trim()}
                  >
                    <RefreshCcw size={15} />
                    <span>重置密码</span>
                  </button>
                </div>
              </article>
            );
          })}
          {!props.users.length && <div className="empty-state large">暂无内部用户</div>}
        </section>

        {props.error && <p className="auth-error admin-error">{props.error}</p>}
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

function customerSubtitle(customer: NonNullable<DashboardState["customers"][number]>): string {
  return [customer.country, customer.stage, customer.loginId].filter(Boolean).join(" · ") || customer.externalCustomerId;
}

function renderNonText(messageType?: string | number): string {
  return `[${messageType ?? "message"}]`;
}

function outboundStatusLabel(status: string): string {
  if (status === "sent") return "已发送";
  if (status === "failed") return "发送失败";
  return "待发送";
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

export function isSessionForConfig(
  session: LoginSessionSnapshot | null,
  config: { serverBaseUrl: string }
): boolean {
  return Boolean(
    session?.token.trim() &&
      session.serverBaseUrl === config.serverBaseUrl
  );
}

function readSessionStorage(config: { serverBaseUrl: string }): LoginSessionSnapshot | null {
  if (typeof window === "undefined") return null;
  window.localStorage.removeItem(STORAGE_KEYS.legacyToken);
  window.localStorage.removeItem(STORAGE_KEYS.legacyCurrentUser);
  const value = window.localStorage.getItem(STORAGE_KEYS.session);
  if (!value) return null;
  try {
    const session = JSON.parse(value) as LoginSessionSnapshot;
    if (isSessionForConfig(session, config)) return session;
  } catch {
    // Invalid snapshots are discarded below.
  }
  window.localStorage.removeItem(STORAGE_KEYS.session);
  return null;
}

function writeSessionStorage(session: LoginSessionSnapshot | null): void {
  if (typeof window === "undefined") return;
  if (!session) {
    window.localStorage.removeItem(STORAGE_KEYS.session);
    return;
  }
  window.localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(session));
}
