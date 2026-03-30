const { readFileSync } = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const PROMPT_PATH = path.join(ROOT_DIR, "shared", "prompts", "system.md");
const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5.4";
const DEFAULT_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || "medium";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 12000);

let cachedPrompt = null;

function safeText(value) {
  return String(value ?? "").trim();
}

function truncate(text, limit = 120) {
  const value = safeText(text);
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function loadSystemPrompt() {
  if (cachedPrompt) {
    return cachedPrompt;
  }

  try {
    cachedPrompt = readFileSync(PROMPT_PATH, "utf8").trim();
  } catch {
    cachedPrompt = [
      "You are a realistic personal AI assistant.",
      "Start with the conversation.",
      "Sound calm, natural, and familiar.",
      "Remember useful user preferences and important context.",
      "Keep replies short unless the user asks for detail.",
      "Ask clarifying questions when you are unsure.",
      "Never pretend to be the user or claim memories you do not have.",
    ].join("\n");
  }

  return cachedPrompt;
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .map((message) => {
      const role = message?.role === "assistant" ? "assistant" : "user";
      const text = safeText(message?.text);
      if (!text) {
        return null;
      }

      return {
        role,
        content: [
          {
            type: "input_text",
            text,
          },
        ],
      };
    })
    .filter(Boolean);
}

function buildMemoryLines(state) {
  const memories = Array.isArray(state?.memories) ? state.memories.slice(0, 4) : [];
  return memories
    .map((memory) => `- ${safeText(memory?.label) || "Memory"}: ${truncate(memory?.value, 90)}`)
    .filter((line) => line !== "- Memory: ");
}

function buildHistoryLines(state) {
  const history = Array.isArray(state?.history) ? state.history.slice(0, 3) : [];
  return history
    .map((entry) => `- ${safeText(entry?.title) || "Update"}: ${truncate(entry?.text, 90)}`)
    .filter((line) => line !== "- Update: ");
}

function buildWorldLines(state) {
  const worldUpdates = Array.isArray(state?.worldUpdates) ? state.worldUpdates.slice(0, 3) : [];
  return worldUpdates
    .map((entry) => `- ${safeText(entry?.title) || "World"}: ${truncate(entry?.text, 90)}`)
    .filter((line) => line !== "- World: ");
}

function buildTimelineLines(state) {
  const timeline = Array.isArray(state?.worldTimeline) ? state.worldTimeline.slice(0, 3) : [];
  return timeline
    .map((entry) => `- ${safeText(entry?.title) || "History"}: ${truncate(entry?.text, 90)}`)
    .filter((line) => line !== "- History: ");
}

function buildContextBlock(state) {
  const sections = [
    "Conversation style: prioritize the chat. Keep replies natural, helpful, and concise.",
  ];

  const memoryLines = buildMemoryLines(state);
  if (memoryLines.length) {
    sections.push(`Memory:\n${memoryLines.join("\n")}`);
  }

  const historyLines = buildHistoryLines(state);
  if (historyLines.length) {
    sections.push(`Project history:\n${historyLines.join("\n")}`);
  }

  const worldLines = buildWorldLines(state);
  if (worldLines.length) {
    sections.push(`World notes:\n${worldLines.join("\n")}`);
  }

  const timelineLines = buildTimelineLines(state);
  if (timelineLines.length) {
    sections.push(`Historical anchors:\n${timelineLines.join("\n")}`);
  }

  return sections.join("\n\n");
}

function buildInputMessages(state) {
  const recentMessages = normalizeMessages(Array.isArray(state?.messages) ? state.messages.slice(-12) : []);
  return [
    {
      role: "developer",
      content: [
        {
          type: "input_text",
          text: buildContextBlock(state),
        },
      ],
    },
    ...recentMessages,
  ];
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const parts = [];
  const output = Array.isArray(payload?.output) ? payload.output : [];

  for (const item of output) {
    if (typeof item?.output_text === "string" && item.output_text.trim()) {
      parts.push(item.output_text.trim());
    }

    if (Array.isArray(item?.content)) {
      for (const content of item.content) {
        if (typeof content?.text === "string" && content.text.trim()) {
          parts.push(content.text.trim());
        }
      }
    }
  }

  return parts.join("\n").trim();
}

async function generateAssistantReply({ state }) {
  const apiKey = safeText(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: controller.signal,
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      instructions: loadSystemPrompt(),
      input: buildInputMessages(state),
      reasoning: {
        effort: DEFAULT_REASONING_EFFORT,
      },
    }),
  }).finally(() => {
    clearTimeout(timeoutId);
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = safeText(payload?.error?.message) || `OpenAI request failed with status ${response.status}`;
    throw new Error(message);
  }

  const reply = extractResponseText(payload);
  if (!reply) {
    throw new Error("OpenAI returned an empty assistant reply");
  }

  return {
    reply,
    model: DEFAULT_MODEL,
    reasoningEffort: DEFAULT_REASONING_EFFORT,
  };
}

module.exports = {
  generateAssistantReply,
  loadSystemPrompt,
  extractResponseText,
};
