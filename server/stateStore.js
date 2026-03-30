import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, "data");
const statePath = path.join(dataDir, "state.json");

function ensureDataDir() {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

export function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

export function createInitialState() {
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

export function normalizeState(state) {
  const seed = createInitialState();

  if (!state || typeof state !== "object") {
    return seed;
  }

  return {
    conversations: Array.isArray(state.conversations) ? state.conversations : seed.conversations,
    memories: Array.isArray(state.memories) ? state.memories : seed.memories,
    messages: Array.isArray(state.messages) ? state.messages : seed.messages,
  };
}

export function loadState() {
  ensureDataDir();

  if (!existsSync(statePath)) {
    return saveState(createInitialState());
  }

  try {
    const raw = readFileSync(statePath, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch {
    return createInitialState();
  }
}

export function saveState(state) {
  ensureDataDir();
  const normalized = normalizeState(state);
  writeFileSync(statePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export function resetState() {
  return saveState(createInitialState());
}

export function createTitleFromText(text) {
  const cleaned = text.replace(/^\/\w+\s*/, "").replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ").filter(Boolean).slice(0, 4);
  return words.length ? words.join(" ") : "New chat";
}

export function updateConversationPreview(state, text, role) {
  const conversation = state.conversations[0];
  if (!conversation) {
    return state;
  }

  if (role === "user" && conversation.title === "New chat") {
    conversation.title = createTitleFromText(text);
  }

  conversation.summary = role === "assistant" ? text : `You said: ${text}`;
  return state;
}

export function appendMessage(state, role, text) {
  state.messages.push({
    id: createId("message"),
    role,
    text,
    createdAt: nowIso(),
  });

  updateConversationPreview(state, text, role);
  return state;
}

export function upsertMemory(state, label, value) {
  const cleanLabel = String(label || "").trim();
  const cleanValue = String(value || "").trim();

  if (!cleanLabel || !cleanValue) {
    return null;
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

  return memory;
}

export function summarizeMemories(memories = []) {
  if (!memories.length) {
    return "I do not have any saved memories yet.";
  }

  return `I remember ${memories.map((memory) => `${memory.label}: ${memory.value}`).join("; ")}.`;
}

export function summarizeConversation(recentMessages = [], memories = []) {
  const userMessages = recentMessages.filter((message) => message.role === "user");
  const latestUser = userMessages[userMessages.length - 1];
  const latestText = latestUser ? `Latest point: "${latestUser.text}".` : "No user messages yet.";

  return `We have ${userMessages.length} user message${userMessages.length === 1 ? "" : "s"} and ${memories.length} saved memory${memories.length === 1 ? "" : "ies"}. ${latestText}`;
}

export function buildMemoryContext(memories = []) {
  if (!memories.length) {
    return "No saved memories yet.";
  }

  return memories.map((memory) => `- ${memory.label}: ${memory.value}`).join("\n");
}
