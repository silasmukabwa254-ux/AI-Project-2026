const { readFileSync } = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const PROMPT_PATH = path.join(ROOT_DIR, "shared", "prompts", "system.md");
const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5.4";
const DEFAULT_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || "medium";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 12000);
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "my",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

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

function normalizeSearchText(text) {
  return safeText(text).toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(text) {
  const normalized = normalizeSearchText(text);
  if (!normalized) {
    return [];
  }

  return [...new Set(normalized.split(" ").filter((token) => token.length > 2 && !STOP_WORDS.has(token)))];
}

function scoreTextAgainstQuery(text, queryTokens) {
  if (!Array.isArray(queryTokens) || !queryTokens.length) {
    return 0;
  }

  const normalized = normalizeSearchText(text);
  if (!normalized) {
    return 0;
  }

  const exactQuery = queryTokens.join(" ");
  let score = 0;

  for (const token of queryTokens) {
    if (normalized.includes(token)) {
      score += token.length >= 6 ? 4 : 2;
    }
  }

  if (exactQuery && normalized.includes(exactQuery)) {
    score += 6;
  }

  return score;
}

function rankEntries(entries, query, getText, limit = 3) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) {
    return [];
  }

  const queryTokens = tokenize(query);
  if (!queryTokens.length) {
    return list.slice(0, limit);
  }

  return list
    .map((entry, index) => ({
      entry,
      score: scoreTextAgainstQuery(getText(entry), queryTokens) + Math.max(0, 6 - index) * 0.15,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.entry);
}

function getLatestUserMessageText(state) {
  const messages = Array.isArray(state?.messages) ? state.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && safeText(message?.text)) {
      return safeText(message.text);
    }
  }

  return "";
}

function getConversationContinuity(state) {
  const conversations = Array.isArray(state?.conversations) ? state.conversations : [];
  const conversationResponseId = safeText(conversations[0]?.lastResponseId);
  const messages = Array.isArray(state?.messages) ? state.messages : [];

  let lastResponseIndex = -1;
  let lastMessageResponseId = "";

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && safeText(message?.responseId)) {
      lastResponseIndex = index;
      lastMessageResponseId = safeText(message.responseId);
      break;
    }
  }

  const tail = lastResponseIndex >= 0 ? messages.slice(lastResponseIndex + 1) : messages;
  const hasLocalAssistantTurn = tail.some((message) => message?.role === "assistant" && !safeText(message?.responseId));

  if (hasLocalAssistantTurn) {
    return {
      responseId: "",
      usePreviousResponse: false,
    };
  }

  const responseId = lastMessageResponseId || conversationResponseId;
  if (!responseId) {
    return {
      responseId: "",
      usePreviousResponse: false,
    };
  }

  return {
    responseId,
    usePreviousResponse: true,
  };
}

function loadSystemPrompt() {
  if (cachedPrompt) {
    return cachedPrompt;
  }

  try {
    cachedPrompt = readFileSync(PROMPT_PATH, "utf8").trim();
  } catch {
    cachedPrompt = [
      "You are Elyra, a realistic personal AI assistant.",
      "Answer the user's latest request directly.",
      "Stay calm, natural, and useful.",
      "Use relevant memory, history, and world context only when it helps.",
      "Use web search for current, recent, local, factual, or hard-to-verify questions.",
      "If something is missing, ask one focused follow-up question.",
      "Keep replies concise unless the user asks for detail.",
      "Never invent memories, world events, or project details.",
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

function buildMemoryLines(state, query) {
  const memories = rankEntries(
    Array.isArray(state?.memories) ? state.memories : [],
    query,
    (memory) => `${safeText(memory?.label)} ${safeText(memory?.value)}`,
    4,
  );

  return memories
    .map((memory) => `- ${safeText(memory?.label) || "Memory"}: ${truncate(memory?.value, 90)}`)
    .filter((line) => line !== "- Memory: ");
}

function buildHistoryLines(state, query) {
  const history = rankEntries(
    Array.isArray(state?.history) ? state.history : [],
    query,
    (entry) => `${safeText(entry?.title)} ${safeText(entry?.text)}`,
    3,
  );

  return history
    .map((entry) => `- ${safeText(entry?.title) || "Update"}: ${truncate(entry?.text, 90)}`)
    .filter((line) => line !== "- Update: ");
}

function buildWorldLines(state, query) {
  const worldUpdates = rankEntries(
    Array.isArray(state?.worldUpdates) ? state.worldUpdates : [],
    query,
    (entry) => `${safeText(entry?.title)} ${safeText(entry?.text)} ${safeText(entry?.region)} ${safeText(entry?.source)}`,
    3,
  );

  return worldUpdates
    .map((entry) => `- ${safeText(entry?.title) || "World"}: ${truncate(entry?.text, 90)}`)
    .filter((line) => line !== "- World: ");
}

function buildTimelineLines(state, query) {
  const timeline = rankEntries(
    Array.isArray(state?.worldTimeline) ? state.worldTimeline : [],
    query,
    (entry) => `${safeText(entry?.title)} ${safeText(entry?.text)} ${safeText(entry?.era)} ${safeText(entry?.source)}`,
    3,
  );

  return timeline
    .map((entry) => `- ${safeText(entry?.title) || "History"}: ${truncate(entry?.text, 90)}`)
    .filter((line) => line !== "- History: ");
}

function buildContextBlock(state, userMessage) {
  const query = safeText(userMessage) || getLatestUserMessageText(state);
  const sections = [
    "You are Elyra, a realistic personal AI assistant.",
    "Answer the user's latest request directly.",
    "Stay calm, natural, and useful.",
    "Keep replies concise unless the user asks for detail.",
    "If something is missing, ask one focused question instead of guessing.",
  ];

  if (query) {
    sections.push(`Latest user request:\n- ${truncate(query, 180)}`);
  }

  const conversationSummary = safeText(state?.conversations?.[0]?.summary);
  if (conversationSummary) {
    sections.push(`Conversation summary:\n- ${truncate(conversationSummary, 180)}`);
  }

  const memoryLines = buildMemoryLines(state, query);
  if (memoryLines.length) {
    sections.push(`Relevant memory:\n${memoryLines.join("\n")}`);
  }

  const historyLines = buildHistoryLines(state, query);
  if (historyLines.length) {
    sections.push(`Relevant project history:\n${historyLines.join("\n")}`);
  }

  const worldLines = buildWorldLines(state, query);
  if (worldLines.length) {
    sections.push(`Relevant world notes:\n${worldLines.join("\n")}`);
  }

  const timelineLines = buildTimelineLines(state, query);
  if (timelineLines.length) {
    sections.push(`Relevant historical anchors:\n${timelineLines.join("\n")}`);
  }

  return sections.join("\n\n");
}

function buildInputMessages(state, userMessage, usePreviousResponse) {
  const developerMessage = {
    role: "developer",
    content: [
      {
        type: "input_text",
        text: buildContextBlock(state, userMessage),
      },
    ],
  };

  if (usePreviousResponse) {
    const text = safeText(userMessage) || getLatestUserMessageText(state);
    return text
      ? [
          developerMessage,
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text,
              },
            ],
          },
        ]
      : [developerMessage];
  }

  const recentMessages = normalizeMessages(Array.isArray(state?.messages) ? state.messages.slice(-12) : []);
  return [
    developerMessage,
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

async function generateAssistantReply({ state, userMessage }) {
  const apiKey = safeText(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const continuity = getConversationContinuity(state);
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
      previous_response_id: continuity.usePreviousResponse ? continuity.responseId : undefined,
      input: buildInputMessages(state, userMessage, continuity.usePreviousResponse),
      tools: [
        {
          type: "web_search",
          search_context_size: "medium",
        },
      ],
      tool_choice: "auto",
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
    responseId: safeText(payload?.id),
  };
}

module.exports = {
  generateAssistantReply,
  loadSystemPrompt,
  extractResponseText,
};
