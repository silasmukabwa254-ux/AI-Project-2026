const STORAGE_KEY = "ai-project-2026-state";
const API_BASE_URL = "http://localhost:3000";
const CHAT_API_URL = `${API_BASE_URL}/chat`;
const STATE_API_URL = `${API_BASE_URL}/state`;

// Small helpers for the starter prototype.
function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function createInitialState() {
  const createdAt = nowIso();

  return {
    conversations: [
      {
        id: createId("conversation"),
        title: "New chat",
        summary: "Main workspace",
        createdAt,
      },
    ],
    memories: [
      {
        id: createId("memory"),
        label: "Assistant tone",
        value: "Realistic, calm, and familiar",
        createdAt,
      },
    ],
    messages: [
      {
        id: createId("message"),
        role: "assistant",
        text: "Welcome to AI Project 2026. We can shape the layout first, then add intelligence.",
        createdAt,
      },
    ],
  };
}

function normalizeState(nextState) {
  const seed = createInitialState();

  if (!nextState || typeof nextState !== "object") {
    return seed;
  }

  return {
    conversations: Array.isArray(nextState.conversations) && nextState.conversations.length ? nextState.conversations : seed.conversations,
    memories: Array.isArray(nextState.memories) && nextState.memories.length ? nextState.memories : seed.memories,
    messages: Array.isArray(nextState.messages) && nextState.messages.length ? nextState.messages : seed.messages,
  };
}

// Persisted state for the browser cache.
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createInitialState();
    }

    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch {
    return createInitialState();
  }
}

const elements = {
  composer: document.getElementById("composer"),
  messageInput: document.getElementById("message-input"),
  messages: document.getElementById("messages"),
  conversationList: document.getElementById("conversation-list"),
  memoryPreview: document.getElementById("memory-preview"),
  quickActions: document.getElementById("quick-actions"),
};

let state = loadState();

// Save and render helpers.
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Local storage is best-effort in this starter build.
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTime(iso) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function renderConversations() {
  elements.conversationList.innerHTML = state.conversations
    .map((conversation) => {
      const summary = conversation.summary || "Main workspace";

      return `
        <div class="item">
          <strong>${escapeHtml(conversation.title)}</strong>
          <small>${escapeHtml(summary)}</small>
        </div>
      `;
    })
    .join("");
}

function renderMemories() {
  elements.memoryPreview.innerHTML = state.memories.length
    ? state.memories
        .map((memory) => {
          return `
            <div class="item">
              <strong>${escapeHtml(memory.label)}</strong>
              <small>${escapeHtml(memory.value)}</small>
            </div>
          `;
        })
        .join("")
    : `
      <div class="item">
        <strong>No memory yet</strong>
        <small>Save a note or tell me a fact.</small>
      </div>
    `;
}

function renderMessages() {
  elements.messages.innerHTML = state.messages
    .map((message) => {
      const roleLabel = message.role === "assistant" ? "AI" : "You";

      return `
        <article class="message message--${message.role}">
          <div class="message__meta">
            <span class="message__role">${roleLabel}</span>
            <span>${formatTime(message.createdAt)}</span>
          </div>
          <p class="message__text">${escapeHtml(message.text)}</p>
        </article>
      `;
    })
    .join("");

  const lastMessage = elements.messages.lastElementChild;
  if (lastMessage) {
    lastMessage.scrollIntoView({ block: "end" });
  }
}

function renderApp() {
  renderConversations();
  renderMemories();
  renderMessages();
}

function applyState(nextState) {
  state = normalizeState(nextState);
  saveState();
  renderApp();
}

// Memory helpers.
function upsertMemory(label, value) {
  const cleanLabel = label.trim();
  const cleanValue = value.trim();

  if (!cleanLabel || !cleanValue) {
    return false;
  }

  const existingIndex = state.memories.findIndex((memory) => memory.label.toLowerCase() === cleanLabel.toLowerCase());
  const memory = {
    id: existingIndex >= 0 ? state.memories[existingIndex].id : createId("memory"),
    label: cleanLabel,
    value: cleanValue,
    createdAt: existingIndex >= 0 ? state.memories[existingIndex].createdAt : nowIso(),
    updatedAt: nowIso(),
  };

  if (existingIndex >= 0) {
    state.memories[existingIndex] = memory;
  } else {
    state.memories.unshift(memory);
  }

  saveState();
  renderMemories();
  return true;
}

function createTitleFromText(text) {
  const cleaned = text.replace(/^\/\w+\s*/, "").replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ").filter(Boolean).slice(0, 4);
  return words.length ? words.join(" ") : "New chat";
}

function updateConversationPreview(text, role) {
  const conversation = state.conversations[0];
  if (!conversation) {
    return;
  }

  if (role === "user" && conversation.title === "New chat") {
    conversation.title = createTitleFromText(text);
  }

  conversation.summary = role === "assistant" ? text : `You said: ${text}`;
}

function extractMemory(text) {
  const rememberCommand = text.match(/^\/remember\s+(.+)/i);
  if (rememberCommand) {
    return { label: "Memory", value: rememberCommand[1].trim() };
  }

  const favoriteMatch = text.match(/my favorite ([a-z ]+?) is (.+)/i);
  if (favoriteMatch) {
    return {
      label: `Favorite ${favoriteMatch[1].trim()}`,
      value: favoriteMatch[2].trim().replace(/[.!?]+$/g, ""),
    };
  }

  const nameMatch = text.match(/my name is (.+)/i);
  if (nameMatch) {
    return {
      label: "Name",
      value: nameMatch[1].trim().replace(/[.!?]+$/g, ""),
    };
  }

  const likeMatch = text.match(/i like (.+)/i);
  if (likeMatch) {
    return {
      label: "Preference",
      value: likeMatch[1].trim().replace(/[.!?]+$/g, ""),
    };
  }

  return null;
}

function summarizeConversation() {
  const userMessages = state.messages.filter((message) => message.role === "user");
  const latestUser = userMessages[userMessages.length - 1];
  const memoryCount = state.memories.length;
  const messageCount = userMessages.length;
  const latestText = latestUser ? `Latest point: "${latestUser.text}".` : "No user messages yet.";

  return `We have ${messageCount} user message${messageCount === 1 ? "" : "s"} and ${memoryCount} saved memory${memoryCount === 1 ? "" : "ies"}. ${latestText}`;
}

function summarizeMemories() {
  if (!state.memories.length) {
    return "I do not have any saved memories yet.";
  }

  return `I remember ${state.memories.map((memory) => `${memory.label}: ${memory.value}`).join("; ")}.`;
}

function pick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function createDefaultReply() {
  const openers = ["That makes sense.", "I'm with you.", "I see the direction."];
  const followUps = [
    "Want me to turn that into a note?",
    "We can save the key part if you want.",
    "If this matters, I can remember it.",
  ];

  return `${pick(openers)} ${pick(followUps)}`;
}

function generateAssistantReply(text) {
  const normalized = text.trim().toLowerCase();

  if (normalized === "/summary") {
    return {
      text: summarizeConversation(),
      memory: null,
      resetState: false,
      skipAssistantMessage: false,
    };
  }

  if (normalized === "/clear") {
    return {
      text: "Chat cleared and reset to the starter state.",
      memory: null,
      resetState: true,
      skipAssistantMessage: true,
    };
  }

  if (normalized.startsWith("/note ")) {
    const note = text.slice(6).trim();
    if (!note) {
      return {
        text: "Add text after /note to save a note.",
        memory: null,
        resetState: false,
        skipAssistantMessage: false,
      };
    }

    return {
      text: `Saved a note: ${note}`,
      memory: {
        label: "Note",
        value: note,
      },
      resetState: false,
      skipAssistantMessage: false,
    };
  }

  const memoryCandidate = extractMemory(text);
  if (memoryCandidate) {
    return {
      text: `I'll remember ${memoryCandidate.label.toLowerCase()}: ${memoryCandidate.value}.`,
      memory: memoryCandidate,
      resetState: false,
      skipAssistantMessage: false,
    };
  }

  if (normalized.includes("what do you remember") || normalized.includes("what have you learned")) {
    return {
      text: summarizeMemories(),
      memory: null,
      resetState: false,
      skipAssistantMessage: false,
    };
  }

  if (normalized.includes("who are you") || normalized.includes("what are you")) {
    return {
      text: "I am the starter version of your personal AI assistant, built to feel realistic and familiar.",
      memory: null,
      resetState: false,
      skipAssistantMessage: false,
    };
  }

  if (normalized.includes("help")) {
    return {
      text: "Try /remember, /note, /summary, or ask me what I remember.",
      memory: null,
      resetState: false,
      skipAssistantMessage: false,
    };
  }

  return {
    text: createDefaultReply(),
    memory: null,
    resetState: false,
    skipAssistantMessage: false,
  };
}

function applyAssistantResult(result) {
  if (result.resetState) {
    state = createInitialState();
    saveState();
    renderApp();
    return;
  }

  if (result.memory) {
    upsertMemory(result.memory.label, result.memory.value);
  }

  if (!result.skipAssistantMessage && result.text) {
    addMessage("assistant", result.text);
  }
}

async function loadServerState() {
  const response = await fetch(STATE_API_URL);

  if (!response.ok) {
    throw new Error(`State request failed with ${response.status}`);
  }

  const data = await response.json();
  return normalizeState(data.state);
}

async function requestServerChat(text) {
  const response = await fetch(CHAT_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Chat request failed with ${response.status}`);
  }

  return response.json();
}

function addMessage(role, text) {
  state.messages.push({
    id: createId("message"),
    role,
    text,
    createdAt: nowIso(),
  });

  updateConversationPreview(text, role);
  saveState();
  renderApp();
}

function submitMessage(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }

  addMessage("user", trimmed);
  elements.messageInput.value = "";

  window.setTimeout(async () => {
    let data;

    try {
      data = await requestServerChat(trimmed);
    } catch {
      data = null;
    }

    if (data && data.state) {
      applyState(data.state);
      return;
    }

    applyAssistantResult(generateAssistantReply(trimmed));
  }, 220);
}

// Wire the form and quick actions.
function handleSubmit(event) {
  event.preventDefault();
  submitMessage(elements.messageInput.value);
}

function handleQuickActionClick(event) {
  const button = event.target.closest("[data-command]");
  if (!button) {
    return;
  }

  submitMessage(button.dataset.command || "");
  elements.messageInput.focus();
}

elements.composer.addEventListener("submit", handleSubmit);
elements.quickActions.addEventListener("click", handleQuickActionClick);

async function bootstrapApp() {
  renderApp();

  try {
    const serverState = await loadServerState();
    applyState(serverState);
  } catch {
    // The browser cache stays active if the server is not running yet.
  }

  elements.messageInput.focus();
}

bootstrapApp();
