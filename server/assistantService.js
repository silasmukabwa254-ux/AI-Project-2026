import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMemoryContext, summarizeMemories } from "./stateStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const promptPath = path.resolve(__dirname, "../shared/prompts/system.md");
const basePrompt = readFileSync(promptPath, "utf8").trim();
const model = process.env.OPENAI_MODEL || "gpt-5.4";
const apiKey = process.env.OPENAI_API_KEY || "";

const replySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: {
      type: "string",
    },
    save_memory: {
      type: "boolean",
    },
    memory_label: {
      type: "string",
    },
    memory_value: {
      type: "string",
    },
    reset_state: {
      type: "boolean",
    },
  },
  required: ["reply", "save_memory", "memory_label", "memory_value", "reset_state"],
};

function parseOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    if (!item || item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }

    for (const chunk of item.content) {
      if (chunk && chunk.type === "output_text" && typeof chunk.text === "string") {
        return chunk.text.trim();
      }
      if (chunk && chunk.type === "text" && typeof chunk.text === "string") {
        return chunk.text.trim();
      }
    }
  }

  return "";
}

function extractMemory(text) {
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

function createFallbackReply(message, state) {
  const normalized = message.trim().toLowerCase();
  const memoryCandidate = extractMemory(message);

  if (memoryCandidate) {
    return {
      reply: `I'll remember ${memoryCandidate.label.toLowerCase()}: ${memoryCandidate.value}.`,
      save_memory: true,
      memory_label: memoryCandidate.label,
      memory_value: memoryCandidate.value,
      reset_state: false,
    };
  }

  if (normalized.includes("what do you remember") || normalized.includes("what have you learned")) {
    return {
      reply: summarizeMemories(state.memories),
      save_memory: false,
      memory_label: "",
      memory_value: "",
      reset_state: false,
    };
  }

  if (normalized.includes("who are you") || normalized.includes("what are you")) {
    return {
      reply: "I am the starter version of your personal AI assistant, built to feel realistic and familiar.",
      save_memory: false,
      memory_label: "",
      memory_value: "",
      reset_state: false,
    };
  }

  if (normalized.includes("help")) {
    return {
      reply: "Try /remember, /note, /summary, or ask me what I remember.",
      save_memory: false,
      memory_label: "",
      memory_value: "",
      reset_state: false,
    };
  }

  const openers = ["That makes sense.", "I'm with you.", "I see the direction."];
  const followUps = [
    "Want me to turn that into a note?",
    "We can save the key part if you want.",
    "If this matters, I can remember it.",
  ];

  return {
    reply: `${openers[Math.floor(Math.random() * openers.length)]} ${followUps[Math.floor(Math.random() * followUps.length)]}`,
    save_memory: false,
    memory_label: "",
    memory_value: "",
    reset_state: false,
  };
}

function buildInstructions(state) {
  return [
    basePrompt,
    "",
    "Current saved memories:",
    buildMemoryContext(state.memories),
    "",
    "Conversation rules:",
    "- Keep replies calm, natural, and familiar.",
    "- If the user gives a stable personal fact, set save_memory to true and fill memory_label and memory_value.",
    "- If no memory should be stored, set save_memory to false and leave memory_label and memory_value empty.",
    "- Reply in plain text only through the structured JSON schema.",
    "- Do not claim you remember something unless memory fields say so.",
  ].join("\n");
}

function buildInput(recentMessages, message) {
  const contextMessages = recentMessages.map((entry) => ({
    role: entry.role,
    content: [
      {
        type: "input_text",
        text: entry.text,
      },
    ],
  }));

  return [
    ...contextMessages,
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: message,
        },
      ],
    },
  ];
}

function normalizeModelReply(parsed) {
  return {
    reply: typeof parsed?.reply === "string" ? parsed.reply.trim() : "",
    save_memory: Boolean(parsed?.save_memory),
    memory_label: typeof parsed?.memory_label === "string" ? parsed.memory_label.trim() : "",
    memory_value: typeof parsed?.memory_value === "string" ? parsed.memory_value.trim() : "",
    reset_state: Boolean(parsed?.reset_state),
  };
}

export async function generateAssistantReply({ state, message, recentMessages = [] }) {
  if (!apiKey) {
    return {
      ...createFallbackReply(message, state),
      source: "fallback",
    };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: buildInstructions(state),
        input: buildInput(recentMessages, message),
        text: {
          format: {
            type: "json_schema",
            name: "assistant_reply",
            strict: true,
            schema: replySchema,
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed with ${response.status}`);
    }

    const data = await response.json();
    const rawText = parseOutputText(data);
    if (!rawText) {
      throw new Error("OpenAI response did not include output text.");
    }

    return {
      ...normalizeModelReply(JSON.parse(rawText)),
      source: "openai",
    };
  } catch {
    return {
      ...createFallbackReply(message, state),
      source: "fallback",
    };
  }
}

export function getAssistantModelName() {
  return model;
}
