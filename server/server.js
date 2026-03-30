import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendMessage,
  loadState,
  resetState,
  saveState,
  summarizeConversation,
  upsertMemory,
} from "./stateStore.js";
import { generateAssistantReply, getAssistantModelName } from "./assistantService.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDir = path.resolve(__dirname, "../client");

app.use(cors());
app.use(express.json());
app.use(express.static(clientDir));

function isCommand(message, prefix) {
  return message.trim().toLowerCase().startsWith(prefix);
}

function handleCommand(state, message) {
  const trimmed = message.trim();
  const normalized = trimmed.toLowerCase();

  if (normalized === "/clear") {
    return {
      reply: "Chat cleared and reset to the starter state.",
      state: resetState(),
      source: "command",
    };
  }

  appendMessage(state, "user", trimmed);

  if (normalized === "/summary") {
    const reply = summarizeConversation(state.messages, state.memories);
    appendMessage(state, "assistant", reply);
    saveState(state);

    return {
      reply,
      state,
      source: "command",
    };
  }

  if (isCommand(trimmed, "/note ")) {
    const note = trimmed.slice(6).trim();
    const reply = note ? `Saved a note: ${note}` : "Add text after /note to save a note.";

    if (note) {
      upsertMemory(state, "Note", note);
    }

    appendMessage(state, "assistant", reply);
    saveState(state);

    return {
      reply,
      state,
      source: "command",
    };
  }

  if (isCommand(trimmed, "/remember ")) {
    const value = trimmed.slice(10).trim();
    const reply = value ? `I'll remember that: ${value}.` : "Add text after /remember to save a fact.";

    if (value) {
      upsertMemory(state, "Memory", value);
    }

    appendMessage(state, "assistant", reply);
    saveState(state);

    return {
      reply,
      state,
      source: "command",
    };
  }

  return null;
}

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    project: "AI Project 2026",
    status: "starter",
    assistantModel: getAssistantModelName(),
  });
});

app.get("/state", (_request, response) => {
  response.json({
    state: loadState(),
    assistantModel: getAssistantModelName(),
  });
});

app.get("/", (_request, response) => {
  response.sendFile(path.join(clientDir, "index.html"));
});

app.post("/chat", async (request, response) => {
  const message = typeof request.body?.message === "string" ? request.body.message.trim() : "";

  if (!message) {
    response.status(400).json({
      reply: "Send a message first.",
      state: loadState(),
      source: "validation",
    });
    return;
  }

  const state = loadState();
  const commandResult = handleCommand(state, message);

  if (commandResult) {
    response.json(commandResult);
    return;
  }

  const recentMessages = state.messages.slice(-8);
  const assistantResult = await generateAssistantReply({
    state,
    message,
    recentMessages,
  });

  appendMessage(state, "user", message);

  if (assistantResult.reset_state) {
    const reset = resetState();
    response.json({
      reply: assistantResult.reply || "Chat reset.",
      state: reset,
      source: assistantResult.source,
    });
    return;
  }

  if (assistantResult.save_memory && assistantResult.memory_label && assistantResult.memory_value) {
    upsertMemory(state, assistantResult.memory_label, assistantResult.memory_value);
  }

  appendMessage(state, "assistant", assistantResult.reply || "I'm here.");
  saveState(state);

  response.json({
    reply: assistantResult.reply || "I'm here.",
    state,
    source: assistantResult.source,
  });
});

app.listen(port, () => {
  console.log(`AI Project 2026 server listening on port ${port}`);
});
