const STORAGE_KEY = "ai-project-2026-state";
const API_BASE_STORAGE_KEY = "ai-project-2026-api-base";

const elements = {
  composer: document.getElementById("composer"),
  settingsButton: document.getElementById("settings-button"),
  messageInput: document.getElementById("message-input"),
  messages: document.getElementById("messages"),
  conversationList: document.getElementById("conversation-list"),
  memoryPreview: document.getElementById("memory-preview"),
  historyPreview: document.getElementById("history-preview"),
  worldUpdatesPreview: document.getElementById("world-updates-preview"),
  worldTimelinePreview: document.getElementById("world-timeline-preview"),
  metricConversations: document.getElementById("metric-conversations"),
  metricMemories: document.getElementById("metric-memories"),
  metricWorld: document.getElementById("metric-world"),
  syncBadge: document.getElementById("sync-badge"),
  activityPreview: document.getElementById("activity-preview"),
  historyForm: document.getElementById("history-form"),
  historyInput: document.getElementById("history-input"),
  worldForm: document.getElementById("world-form"),
  worldInput: document.getElementById("world-input"),
  personalityNote: document.getElementById("personality-note"),
  statusTitle: document.getElementById("status-title"),
  statusDetail: document.getElementById("status-detail"),
};

let state = loadState();
let syncStatus = "checking";
let syncInFlight = false;
let syncQueued = false;

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeText(value) {
  return String(value ?? "").trim();
}

function rewriteBrandingText(value) {
  return safeText(value)
    .replaceAll("AI Project 2026", "Elyra")
    .replaceAll("AI Assistant 2026", "Elyra")
    .replaceAll("Assistant 2026", "Elyra");
}

function normalizeApiBaseUrl(value) {
  const text = safeText(value);
  if (!text) {
    return "";
  }

  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }

    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function isLocalhostHost(hostname) {
  return ["localhost", "127.0.0.1", "::1"].includes(safeText(hostname));
}

function isRemotePage() {
  return !isLocalhostHost(window.location.hostname);
}

function isLocalApiBaseUrl(value) {
  return /^(https?:\/\/)?(localhost|127\.0\.0\.1|::1)(:\d+)?/i.test(safeText(value));
}

function getLocalDefaultApiBase() {
  if (!isLocalhostHost(window.location.hostname)) {
    return "";
  }

  return `${window.location.protocol}//${window.location.host}`;
}

function getConfiguredApiBaseUrl() {
  const stored = normalizeApiBaseUrl(window.localStorage.getItem(API_BASE_STORAGE_KEY));
  if (stored) {
    return stored;
  }

  const runtime = normalizeApiBaseUrl(window.AI_PROJECT_CONFIG?.apiBaseUrl);
  if (runtime) {
    return runtime;
  }

  return getLocalDefaultApiBase();
}

function setConfiguredApiBaseUrl(value) {
  const normalized = normalizeApiBaseUrl(value);

  if (normalized) {
    window.localStorage.setItem(API_BASE_STORAGE_KEY, normalized);
  } else {
    window.localStorage.removeItem(API_BASE_STORAGE_KEY);
  }

  return normalized;
}

function buildApiUrl(path) {
  const base = getConfiguredApiBaseUrl();
  if (!base || (isRemotePage() && isLocalApiBaseUrl(base))) {
    return null;
  }

  const cleanPath = safeText(path).replace(/^\/+/, "");
  return new URL(cleanPath, `${base.replace(/\/+$/, "")}/`).toString();
}

function hasRemoteBackendConfigured() {
  const base = getConfiguredApiBaseUrl();
  if (!base) {
    return false;
  }

  return !(isRemotePage() && isLocalApiBaseUrl(base));
}

function getBackendHint() {
  const base = getConfiguredApiBaseUrl();
  if (!base) {
    return "Set backend URL in Settings.";
  }

  if (!hasRemoteBackendConfigured()) {
    return "Backend URL points to localhost.";
  }

  return "";
}

function escapeHtml(value) {
  return safeText(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function truncate(text, limit = 90) {
  const value = safeText(text);
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function formatWhen(iso) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return safeText(iso);
  }
}

function deriveTitle(text) {
  const value = safeText(text);
  if (!value) {
    return "Untitled update";
  }

  return truncate(value.split(/\s+/).slice(0, 6).join(" "), 42);
}

function createDefaultState() {
  const now = nowIso();

  return {
    conversations: [
      {
        id: createId("conv"),
        title: "New chat",
        summary: "Conversation first.",
        lastResponseId: "",
        updatedAt: now,
      },
    ],
    memories: [
      {
        id: createId("mem"),
        label: "Assistant tone",
        value: "Calm. Grounded.",
        updatedAt: now,
      },
      {
        id: createId("mem"),
        label: "Project goal",
        value: "Useful. Trustworthy.",
        updatedAt: now,
      },
    ],
      history: [
        {
          id: createId("hist"),
          title: "Workspace opened",
          text: "Elyra started separate from blast.",
          createdAt: now,
        },
    ],
    worldUpdates: [
      {
        id: createId("world"),
        title: "World lane ready",
        text: "Paste current world updates here.",
        region: "Global",
        source: "system",
        createdAt: now,
      },
    ],
    worldTimeline: [
      {
        id: createId("timeline"),
        title: "Printing press",
        text: "Spread knowledge faster.",
        era: "Early modern era",
        source: "starter",
        createdAt: now,
      },
      {
        id: createId("timeline"),
        title: "Moon landing",
        text: "Humanity reached the Moon in 1969.",
        era: "20th century",
        source: "starter",
        createdAt: now,
      },
      {
        id: createId("timeline"),
        title: "Internet goes global",
        text: "Information became worldwide.",
        era: "Digital age",
        source: "starter",
        createdAt: now,
      },
    ],
    messages: [
      {
        id: createId("msg"),
        role: "assistant",
        text: "Hey. I'm here.",
        createdAt: now,
      },
    ],
    activity: [
      {
        id: createId("act"),
        kind: "system",
        title: "Chat ready",
        detail: "Conversation loaded.",
        createdAt: now,
      },
    ],
  };
}

function compactState(state) {
  const next = normalizeState(state);

  next.conversations = next.conversations.map((conversation) => ({
    ...conversation,
    title: rewriteBrandingText(conversation.title),
    summary: rewriteBrandingText(conversation.summary),
  }));

  next.memories = next.memories.map((memory) => ({
    ...memory,
    label: rewriteBrandingText(memory.label),
    value: rewriteBrandingText(memory.value),
  }));

  next.history = next.history.map((entry) => ({
    ...entry,
    title: rewriteBrandingText(entry.title),
    text: rewriteBrandingText(entry.text),
  }));

  next.worldUpdates = next.worldUpdates.map((entry) => ({
    ...entry,
    title: rewriteBrandingText(entry.title),
    text: rewriteBrandingText(entry.text),
    region: rewriteBrandingText(entry.region),
    source: rewriteBrandingText(entry.source),
  }));

  next.worldTimeline = next.worldTimeline.map((entry) => ({
    ...entry,
    title: rewriteBrandingText(entry.title),
    text: rewriteBrandingText(entry.text),
    era: rewriteBrandingText(entry.era),
    source: rewriteBrandingText(entry.source),
  }));

  next.messages = next.messages.map((message) => ({
    ...message,
    text: rewriteBrandingText(message.text),
  }));

  next.activity = next.activity.map((entry) => ({
    ...entry,
    title: rewriteBrandingText(entry.title),
    detail: rewriteBrandingText(entry.detail),
  }));

  const firstMemory = next.memories[0];
  if (firstMemory?.label === "Assistant tone") {
    firstMemory.value = "Calm. Grounded.";
  }

  const goalMemory = next.memories[1];
  if (goalMemory?.label === "Project goal") {
    goalMemory.value = "Useful. Trustworthy.";
  }

  const firstHistory = next.history[0];
  if (firstHistory?.text.includes("clean workspace separate from blast")) {
    firstHistory.title = "Workspace opened";
    firstHistory.text = "Elyra started separate from blast.";
  }

  const firstWorld = next.worldUpdates[0];
  if (firstWorld?.text.includes("Paste current world updates here")) {
    firstWorld.title = "World lane ready";
    firstWorld.text = "Paste current world updates here.";
  }

  next.worldTimeline = next.worldTimeline.map((entry) => {
    if (entry.source !== "starter") {
      return entry;
    }

    if (entry.title.includes("Printing press")) {
      return {
        ...entry,
        title: "Printing press",
        text: "Spread knowledge faster.",
      };
    }

    if (entry.title.includes("Moon landing")) {
      return {
        ...entry,
        text: "Humanity reached the Moon in 1969.",
      };
    }

    if (entry.title.includes("Internet")) {
      return {
        ...entry,
        title: "Internet goes global",
        text: "Information became worldwide.",
      };
    }

    return entry;
  });

  const welcomeMessage = next.messages[0];
  if (
    welcomeMessage?.role === "assistant" &&
    (welcomeMessage.text.includes("Welcome to Elyra") || welcomeMessage.text.includes("Welcome. Use the panels."))
  ) {
    welcomeMessage.text = "Hey. I'm here.";
  }

  const firstActivity = next.activity[0];
  if (firstActivity?.title === "Session ready" || firstActivity?.title === "Chat ready") {
    firstActivity.title = "Chat ready";
    firstActivity.detail = "Conversation loaded.";
  }

  return next;
}

function normalizeArray(value, mapper, fallback) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value.map(mapper).filter(Boolean);
  return normalized.length ? normalized : fallback;
}

function normalizeConversation(item) {
  return {
    id: safeText(item?.id) || createId("conv"),
    title: safeText(item?.title) || "New chat",
    summary: safeText(item?.summary) || "",
    lastResponseId: safeText(item?.lastResponseId) || "",
    updatedAt: safeText(item?.updatedAt) || nowIso(),
  };
}

function normalizeMemory(item) {
  return {
    id: safeText(item?.id) || createId("mem"),
    label: safeText(item?.label) || "Memory",
    value: safeText(item?.value ?? item?.text),
    updatedAt: safeText(item?.updatedAt) || nowIso(),
  };
}

function normalizeHistory(item) {
  const text = safeText(item?.text ?? item?.value);

  return {
    id: safeText(item?.id) || createId("hist"),
    title: safeText(item?.title) || deriveTitle(text),
    text,
    source: safeText(item?.source) || "manual",
    createdAt: safeText(item?.createdAt) || nowIso(),
  };
}

function normalizeWorldUpdate(item) {
  const text = safeText(item?.text ?? item?.value);

  return {
    id: safeText(item?.id) || createId("world"),
    title: safeText(item?.title) || deriveTitle(text),
    text,
    region: safeText(item?.region) || "Global",
    source: safeText(item?.source) || "manual",
    createdAt: safeText(item?.createdAt) || nowIso(),
  };
}

function normalizeWorldTimeline(item) {
  const text = safeText(item?.text ?? item?.value);

  return {
    id: safeText(item?.id) || createId("timeline"),
    title: safeText(item?.title) || deriveTitle(text),
    text,
    era: safeText(item?.era) || "History",
    source: safeText(item?.source) || "starter",
    createdAt: safeText(item?.createdAt) || nowIso(),
  };
}

function normalizeMessage(item) {
  const responseId = safeText(item?.responseId);

  return {
    id: safeText(item?.id) || createId("msg"),
    role: item?.role === "user" ? "user" : "assistant",
    text: safeText(item?.text),
    createdAt: safeText(item?.createdAt) || nowIso(),
    ...(responseId ? { responseId } : {}),
  };
}

function normalizeActivity(item) {
  return {
    id: safeText(item?.id) || createId("act"),
    kind: safeText(item?.kind) || "system",
    title: safeText(item?.title) || "Update",
    detail: safeText(item?.detail) || "",
    createdAt: safeText(item?.createdAt) || nowIso(),
  };
}

function normalizeState(raw) {
  const base = createDefaultState();

  if (!raw || typeof raw !== "object") {
    return base;
  }

  return {
    conversations: normalizeArray(raw.conversations, normalizeConversation, base.conversations),
    memories: normalizeArray(raw.memories, normalizeMemory, base.memories),
    history: normalizeArray(raw.history, normalizeHistory, base.history),
    worldUpdates: normalizeArray(raw.worldUpdates, normalizeWorldUpdate, base.worldUpdates),
    worldTimeline: normalizeArray(raw.worldTimeline, normalizeWorldTimeline, base.worldTimeline),
    messages: normalizeArray(raw.messages, normalizeMessage, base.messages),
    activity: normalizeArray(raw.activity, normalizeActivity, base.activity),
  };
}

function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return compactState(createDefaultState());
    }

    return compactState(JSON.parse(raw));
  } catch {
    return compactState(createDefaultState());
  }
}

function saveState() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures in restricted browsers.
  }
}

function renderEmptyItem(message) {
  return `<div class="item item--empty">${escapeHtml(message)}</div>`;
}

function renderConversations() {
  if (!elements.conversationList) {
    return;
  }

  const items = state.conversations.slice(0, 6);
  elements.conversationList.innerHTML = items.length
    ? items
        .map(
          (conversation) => `
            <div class="item">
              <p class="feed-title">${escapeHtml(conversation.title)}</p>
              <span class="feed-meta">Updated ${escapeHtml(formatWhen(conversation.updatedAt))}</span>
            </div>
          `,
        )
        .join("")
    : renderEmptyItem("No conversations yet.");
}

function renderMemories() {
  if (!elements.memoryPreview) {
    return;
  }

  const items = state.memories.slice(0, 6);
  elements.memoryPreview.innerHTML = items.length
    ? items
        .map(
          (memory) => `
            <div class="item">
              <p class="feed-title">${escapeHtml(memory.label)}</p>
              <p class="feed-body">${escapeHtml(truncate(memory.value, 36))}</p>
              <span class="feed-meta">Updated ${escapeHtml(formatWhen(memory.updatedAt))}</span>
            </div>
          `,
        )
        .join("")
    : renderEmptyItem("No memories yet.");
}

function renderHistory() {
  if (!elements.historyPreview) {
    return;
  }

  const items = state.history.slice(0, 6);
  elements.historyPreview.innerHTML = items.length
    ? items
        .map(
          (entry) => `
            <div class="item">
              <p class="feed-title">${escapeHtml(entry.title)}</p>
              <span class="feed-meta">${escapeHtml(formatWhen(entry.createdAt))}</span>
            </div>
          `,
        )
        .join("")
    : renderEmptyItem("No history saved yet.");
}

function renderMetrics() {
  if (elements.metricConversations) {
    elements.metricConversations.textContent = String(state.conversations.length);
  }

  if (elements.metricMemories) {
    elements.metricMemories.textContent = String(state.memories.length);
  }

  if (elements.metricWorld) {
    elements.metricWorld.textContent = String(state.worldUpdates.length);
  }
}

function renderWorldUpdates() {
  if (!elements.worldUpdatesPreview) {
    return;
  }

  const items = state.worldUpdates.slice(0, 6);
  elements.worldUpdatesPreview.innerHTML = items.length
    ? items
        .map(
          (entry) => `
            <div class="item item--world">
              <p class="feed-title">${escapeHtml(entry.title)}</p>
              <span class="feed-meta">${escapeHtml(entry.region || "Global")} | ${escapeHtml(entry.source || "manual")} | ${escapeHtml(formatWhen(entry.createdAt))}</span>
            </div>
          `,
        )
        .join("")
    : renderEmptyItem("No world updates yet.");
}

function renderWorldTimeline() {
  if (!elements.worldTimelinePreview) {
    return;
  }

  const items = state.worldTimeline.slice(0, 6);
  elements.worldTimelinePreview.innerHTML = items.length
    ? items
        .map(
          (entry) => `
            <div class="item item--timeline">
              <p class="feed-title">${escapeHtml(entry.title)}</p>
              <span class="feed-meta">${escapeHtml(entry.era || "History")} | ${escapeHtml(entry.source || "starter")} | ${escapeHtml(formatWhen(entry.createdAt))}</span>
            </div>
          `,
        )
        .join("")
    : renderEmptyItem("No world timeline entries yet.");
}

function renderActivity() {
  if (!elements.activityPreview) {
    return;
  }

  const items = state.activity.slice(0, 8);
  elements.activityPreview.innerHTML = items.length
    ? items
        .map(
          (entry) => `
            <div class="item item--${escapeHtml(entry.kind)}">
              <p class="feed-title">${escapeHtml(entry.title)}</p>
              <span class="feed-meta">${escapeHtml(formatWhen(entry.createdAt))}</span>
            </div>
          `,
        )
        .join("")
    : renderEmptyItem("No activity yet.");
}

function renderMessages() {
  if (!elements.messages) {
    return;
  }

  elements.messages.innerHTML = state.messages
    .map(
      (message) => `
        <div class="message message--${message.role}">
          ${escapeHtml(message.text)}
          <span class="message-meta">${escapeHtml(formatWhen(message.createdAt))}</span>
        </div>
      `,
    )
    .join("");

  window.requestAnimationFrame(() => {
    elements.messages.scrollTop = elements.messages.scrollHeight;
  });
}

function renderStatus() {
  const backendHint = getBackendHint();
  const syncLabel =
    syncStatus === "online"
      ? "Synced live."
      : syncStatus === "offline"
        ? "Offline cache."
        : "Checking sync.";

  if (elements.statusTitle) {
    elements.statusTitle.textContent = state.activity[0] ? state.activity[0].title : "Ready";
  }

  if (elements.statusDetail) {
    elements.statusDetail.textContent = backendHint || syncLabel;
  }

  if (elements.syncBadge) {
    if (backendHint) {
      elements.syncBadge.textContent = "Backend needed";
      elements.syncBadge.className = "status-chip status-chip--warn";
      return;
    }

    elements.syncBadge.textContent =
      syncStatus === "online"
        ? "Synced live"
        : syncStatus === "offline"
          ? "Offline cache"
          : "Checking sync";
    elements.syncBadge.className =
      syncStatus === "online"
        ? "status-chip status-chip--live"
        : syncStatus === "offline"
          ? "status-chip status-chip--offline"
          : "status-chip status-chip--checking";
  }
}

function renderInspectorNote() {
  if (!elements.personalityNote) {
    return;
  }

  const latestHistory = state.history[0];
  const latestMemory = state.memories[0];
  const parts = ["Chat"];

  if (latestHistory) {
    parts.push("Project");
  }

  if (latestMemory) {
    parts.push("Memory");
  }

  elements.personalityNote.textContent = parts.join(" | ");
}

function renderAll() {
  renderMetrics();
  renderConversations();
  renderMemories();
  renderHistory();
  renderWorldUpdates();
  renderWorldTimeline();
  renderActivity();
  renderMessages();
  renderStatus();
  renderInspectorNote();
}

function persistAndRender() {
  saveState();
  renderAll();
  void syncStateToServer();
}

async function syncStateToServer() {
  const endpoint = buildApiUrl("state");
  if (!endpoint) {
    syncStatus = "offline";
    renderStatus();
    return;
  }

  if (syncInFlight) {
    syncQueued = true;
    return;
  }

  syncInFlight = true;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ state }),
    });

      if (!response.ok) {
        throw new Error(`Sync failed with status ${response.status}`);
      }

      await response.json().catch(() => null);

      syncStatus = "online";
  } catch {
    syncStatus = "offline";
  } finally {
    syncInFlight = false;
    renderStatus();

    if (syncQueued) {
      syncQueued = false;
      void syncStateToServer();
    }
  }
}

function recordActivity(kind, title, detail) {
  state.activity.unshift({
    id: createId("act"),
    kind: safeText(kind) || "system",
    title: safeText(title) || "Update",
    detail: safeText(detail),
    createdAt: nowIso(),
  });

  state.activity = state.activity.slice(0, 12);
  persistAndRender();
}

function syncConversationTitle(text) {
  const conversation = state.conversations[0];
  if (!conversation) {
    return;
  }

  conversation.updatedAt = nowIso();
  if (conversation.title === "New chat" && safeText(text)) {
    conversation.title = truncate(text, 32);
  }
}

function syncConversationResponseId(responseId) {
  const conversation = state.conversations[0];
  if (!conversation) {
    return;
  }

  conversation.lastResponseId = safeText(responseId);
  conversation.updatedAt = nowIso();
}

function addMessage(role, text, extra = {}) {
  const value = safeText(text);
  const responseId = safeText(extra?.responseId);
  const message = {
    id: createId("msg"),
    role,
    text: value,
    createdAt: nowIso(),
  };

  if (role === "assistant" && responseId) {
    message.responseId = responseId;
    syncConversationResponseId(responseId);
  } else if (role === "assistant") {
    syncConversationResponseId("");
  }

  state.messages.push(message);

  if (role === "user") {
    syncConversationTitle(value);
    recordActivity("user", "Message saved", truncate(value, 120));
    return;
  }

  recordActivity("assistant", "Reply saved", truncate(value, 120));
}

function addMemoryEntry(text, label = deriveTitle(text)) {
  const value = safeText(text);

  state.memories.unshift({
    id: createId("mem"),
    label,
    value,
    updatedAt: nowIso(),
  });

  state.memories = state.memories.slice(0, 8);
  recordActivity("memory", "Memory saved", `${label}: ${truncate(value, 90)}`);
}

function addHistoryEntry(text, source = "manual") {
  const value = safeText(text);

  state.history.unshift({
    id: createId("hist"),
    title: deriveTitle(value),
    text: value,
    source,
    createdAt: nowIso(),
  });

  state.history = state.history.slice(0, 8);
  recordActivity("history", "Project saved", `${source}: ${truncate(value, 90)}`);
}

function addWorldUpdateEntry(text, region = "Global", source = "manual") {
  const value = safeText(text);

  state.worldUpdates.unshift({
    id: createId("world"),
    title: deriveTitle(value),
    text: value,
    region: safeText(region) || "Global",
    source,
    createdAt: nowIso(),
  });

  state.worldUpdates = state.worldUpdates.slice(0, 8);
  recordActivity("world", "World saved", `${region}: ${truncate(value, 90)}`);
}

function resetState() {
  state = createDefaultState();
  recordActivity("system", "Reset", "Context restored.");
}

async function bootstrap() {
  renderAll();

  const endpoint = buildApiUrl("state");
  if (!endpoint) {
    syncStatus = "offline";
    renderStatus();
    return;
  }

  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`State load failed with status ${response.status}`);
    }

    const payload = await response.json();
    state = compactState(payload.state || payload);
    syncStatus = "online";
    saveState();
    renderAll();
    void syncStateToServer();
  } catch {
    syncStatus = "offline";
    renderStatus();
  }
}

function buildSummaryReply() {
  const historyLines = state.history.slice(0, 2).map((entry) => entry.title);
  const worldLines = state.worldUpdates.slice(0, 2).map((entry) => entry.title);
  const timelineLines = state.worldTimeline.slice(0, 2).map((entry) => entry.title);
  const memoryLines = state.memories.slice(0, 2).map((entry) => entry.label);

  return [
    historyLines.length ? `Project: ${historyLines.join(" | ")}` : "Project: none",
    worldLines.length ? `World: ${worldLines.join(" | ")}` : "World: none",
    timelineLines.length ? `History: ${timelineLines.join(" | ")}` : "History: none",
    memoryLines.length ? `Memory: ${memoryLines.join(" | ")}` : "Memory: none",
  ].join("\n");
}

function buildWorldReply() {
  const worldLines = state.worldUpdates.slice(0, 2).map((entry) => entry.title);
  const timelineLines = state.worldTimeline.slice(0, 2).map((entry) => entry.title);

  return [
    worldLines.length ? `World: ${worldLines.join(" | ")}` : "World: none",
    timelineLines.length ? `History: ${timelineLines.join(" | ")}` : "History: none",
  ].join("\n");
}

function hasPattern(text, pattern) {
  return pattern.test(text);
}

function buildGreetingReply() {
  return "Hey. I'm here. What do you want to talk about?";
}

function buildCheckInReply() {
  return "Good. Focused.";
}

function buildThanksReply() {
  return "Any time.";
}

function buildIdentityReply() {
  return "I'm your personal chat assistant.";
}

function buildHelpReply() {
  return "Use /remember, /update, or /summary.";
}

function buildFarewellReply() {
  return "Later.";
}

function buildAcknowledgementReply() {
  return "Okay. What next?";
}

function handleCommand(text) {
  if (!text.startsWith("/")) {
    return null;
  }

  const [rawCommand = "", ...parts] = text.slice(1).trim().split(/\s+/);
  const command = rawCommand.toLowerCase();
  const payload = parts.join(" ").trim();

  if (!command) {
    recordActivity("system", "Empty command", "Use /update, /remember, /world, /timeline, /summary, or /clear.");
    return "Try /update, /remember, /world, /timeline, /summary, or /clear.";
  }

  if (command === "update" || command === "history") {
    if (!payload) {
      recordActivity("system", "Missing text", "The /update command needs a note after it.");
      return "Add an update after /update.";
    }

    addHistoryEntry(payload, "chat");
    return "Project saved.";
  }

  if (command === "remember" || command === "note") {
    if (!payload) {
      recordActivity("system", "Missing text", "The /remember command needs a note after it.");
      return "Add a note after /remember.";
    }

    addMemoryEntry(payload);
    return "Memory saved.";
  }

  if (command === "summary") {
    recordActivity("system", "Summary", "Context summarized.");
    return buildSummaryReply();
  }

  if (command === "world" || command === "news") {
    recordActivity("world", "World", "World notes shown.");
    return buildWorldReply();
  }

  if (command === "timeline" || command === "history-world") {
    recordActivity("world", "History", "History shown.");
    const timelineLines = state.worldTimeline.slice(0, 4).map((entry) => `- ${entry.title} (${entry.era || "History"}): ${truncate(entry.text, 90)}`);
    return timelineLines.length ? `World timeline:\n${timelineLines.join("\n")}` : "No world timeline entries yet.";
  }

  if (command === "clear") {
    resetState();
    return "I cleared the conversation and restored the starter memory.";
  }

  recordActivity("system", "Unknown", `Tried /${command}`);
  return "Unknown command. Try /update, /remember, /summary, or /clear.";
}

function buildAssistantReply(text) {
  const lowerText = text.toLowerCase();
  const normalizedText = lowerText.replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();

  if (
    hasPattern(normalizedText, /\b(what do you remember|show history|world update|current world|timeline|summarize)\b/)
  ) {
    recordActivity("assistant", "Summary", "Context returned.");
    return buildSummaryReply();
  }

  if (hasPattern(normalizedText, /\b(hi|hello|hey|hiya|yo|good morning|good afternoon|good evening)\b/)) {
    recordActivity("assistant", "Greeting", "Greeting returned.");
    return buildGreetingReply();
  }

  if (hasPattern(normalizedText, /\b(thanks|thank you|thx|appreciate it)\b/)) {
    recordActivity("assistant", "Thanks", "Acknowledgement returned.");
    return buildThanksReply();
  }

  if (hasPattern(normalizedText, /\b(how are you|how are you doing|how's it going|how do you feel|what's up|whats up)\b/)) {
    recordActivity("assistant", "Check-in", "Status returned.");
    return buildCheckInReply();
  }

  if (hasPattern(normalizedText, /\b(who are you|what are you|what is your name|who made you)\b/)) {
    recordActivity("assistant", "About", "Identity reply returned.");
    return buildIdentityReply();
  }

  if (hasPattern(normalizedText, /\b(what can you do|help|commands|how do i use you)\b/)) {
    recordActivity("assistant", "About", "Capability reply returned.");
    return buildHelpReply();
  }

  if (hasPattern(normalizedText, /\b(bye|goodbye|see you|later|talk soon)\b/)) {
    recordActivity("assistant", "Farewell", "Farewell returned.");
    return buildFarewellReply();
  }

  if (hasPattern(normalizedText, /\b(okay|ok|cool|nice|alright|sounds good|great)\b/)) {
    recordActivity("assistant", "Ack", "Short acknowledgement returned.");
    return buildAcknowledgementReply();
  }

  const latestMemory = state.memories[0];
  const contextBits = [];

  if (latestMemory) {
    contextBits.push(`memory "${latestMemory.label}"`);
  }

  const contextText = contextBits.length
    ? "I remember your recent context."
    : "Context ready";

  return `${contextText} What do you want to talk through?`;
}

async function requestAssistantReply(text) {
  const endpoint = buildApiUrl("chat");
  if (!endpoint) {
    throw new Error("Backend URL is not configured");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      message: text,
      state,
    }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error || `Chat failed with status ${response.status}`);
  }

  const reply = safeText(payload?.reply);
  if (!reply) {
    throw new Error("Assistant returned an empty reply");
  }

  return {
    reply,
    meta: {
      model: safeText(payload?.meta?.model),
      reasoningEffort: safeText(payload?.meta?.reasoningEffort),
      responseId: safeText(payload?.meta?.responseId),
    },
  };
}

function handleHistorySubmit(event) {
  event.preventDefault();

  if (!elements.historyInput) {
    return;
  }

  const text = elements.historyInput.value.trim();
  if (!text) {
    return;
  }

  elements.historyInput.value = "";
  addHistoryEntry(text, "panel");
  addMessage("assistant", "Project saved.");
}

function handleWorldSubmit(event) {
  event.preventDefault();

  if (!elements.worldInput) {
    return;
  }

  const text = elements.worldInput.value.trim();
  if (!text) {
    return;
  }

  elements.worldInput.value = "";
  addWorldUpdateEntry(text, "Global", "panel");
  addMessage("assistant", "World saved.");
}

function handleSettingsClick() {
  const currentValue = getConfiguredApiBaseUrl();
  const nextValue = window.prompt(
    "Enter the backend URL for this AI assistant.\nUse the hosted backend URL, such as https://your-backend.onrender.com\nLeave blank to clear it.",
    currentValue,
  );

  if (nextValue === null) {
    return;
  }

  const normalized = setConfiguredApiBaseUrl(nextValue);
  if (safeText(nextValue) && !normalized) {
    window.alert("Please enter a full http:// or https:// URL.");
    return;
  }

  recordActivity(
    "system",
    normalized ? "Backend set" : "Backend cleared",
    normalized ? `Using ${normalized}` : "Backend URL removed.",
  );
}

async function handleSubmit(event) {
  event.preventDefault();

  const text = elements.messageInput.value.trim();
  if (!text) {
    return;
  }

  elements.messageInput.value = "";
  addMessage("user", text);

  const commandReply = handleCommand(text);
  if (commandReply) {
    addMessage("assistant", commandReply);
    return;
  }

  try {
    const assistantResult = await requestAssistantReply(text);
    addMessage("assistant", assistantResult.reply, { responseId: assistantResult.meta.responseId });
  } catch {
    window.setTimeout(() => {
      addMessage("assistant", buildAssistantReply(text));
    }, 250);
  }
}

elements.composer.addEventListener("submit", handleSubmit);

if (elements.settingsButton) {
  elements.settingsButton.addEventListener("click", handleSettingsClick);
}

if (elements.historyForm) {
  elements.historyForm.addEventListener("submit", handleHistorySubmit);
}

if (elements.worldForm) {
  elements.worldForm.addEventListener("submit", handleWorldSubmit);
}

void bootstrap();
