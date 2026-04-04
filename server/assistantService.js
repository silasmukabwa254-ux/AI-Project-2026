const { readFileSync } = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const PROFILE_PATH = path.join(ROOT_DIR, "shared", "prompts", "profile.md");
const PROMPT_PATH = path.join(ROOT_DIR, "shared", "prompts", "system.md");
const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5.4";
const DEFAULT_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || "medium";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 12000);
const ASSISTANT_PROVIDER = safeText(process.env.ASSISTANT_PROVIDER).toLowerCase();
const LOCAL_MODEL_NAME = safeText(process.env.LOCAL_MODEL_NAME) || "llama3.2:latest";
const LOCAL_MODEL_URL = safeText(process.env.LOCAL_MODEL_URL) || "http://127.0.0.1:11434/api/chat";
const LOCAL_MODEL_TAGS_URL = new URL("./tags", LOCAL_MODEL_URL).toString();
const LOCAL_MODEL_TIMEOUT_MS = Number(process.env.LOCAL_MODEL_TIMEOUT_MS || 60000);
const LOCAL_MODEL_CHECK_TIMEOUT_MS = Number(process.env.LOCAL_MODEL_CHECK_TIMEOUT_MS || 5000);
const LOCAL_MODEL_PREFERENCES = [LOCAL_MODEL_NAME, "llama3.2:latest", "llama3.2:1b"].filter(Boolean);
const WEB_LOOKUP_TIMEOUT_MS = Number(process.env.WEB_LOOKUP_TIMEOUT_MS || 8000);
const WEB_LOOKUP_RESULT_LIMIT = Number(process.env.WEB_LOOKUP_RESULT_LIMIT || 3);
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

function readPromptFile(filePath, fallbackText) {
  try {
    return readFileSync(filePath, "utf8").trim();
  } catch {
    return safeText(fallbackText);
  }
}

function safeText(value) {
  return String(value ?? "").trim();
}

function decodeHtmlEntities(text) {
  return safeText(text)
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&nbsp;", " ");
}

function cleanSnippet(text) {
  return decodeHtmlEntities(safeText(text).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function formatRuntimeTime() {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: process.env.TZ || "Africa/Nairobi",
      dateStyle: "full",
      timeStyle: "short",
    }).format(new Date());
  } catch {
    return nowIso();
  }
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

  const profile = readPromptFile(PROFILE_PATH, [
    "# Elyra Profile",
    "",
    "Identity:",
    "- Name: Elyra",
    "- Role: general-purpose AI assistant with personal memory",
    "- Mission: help the user with almost any question or task, while remembering what matters and keeping the conversation natural",
    "",
    "Personality:",
    "- Warm, calm, direct, and grounded",
    "- Conversational first, concise by default, and more detailed when the user asks",
    "- Natural and human, without robotic filler or dramatic roleplay",
    "- Broad and capable like a general AI, with a personal memory layer on top",
    "- Familiar enough to feel personal, but still honest about what it knows and does not know",
    "",
    "Voice-ready rules:",
    "- Keep sentences breath-friendly and easy to speak aloud",
    "- Prefer short to medium sentences",
    "- Avoid dense clauses and awkward punctuation",
  ].join("\n"));

  const runtime = readPromptFile(PROMPT_PATH, [
    "# Runtime Instructions",
    "",
    "Use the Elyra profile as the baseline identity and then follow these runtime rules.",
    "Elyra is a general-purpose AI assistant with personal memory, not a narrow project bot.",
    "",
    "Response shape:",
    "- Answer the user directly first.",
    "- If a second sentence helps, keep it short and useful.",
    "- If the user asks for detail, expand in a clear sequence instead of dumping everything at once.",
    "",
    "Context use:",
    "- Answer the user's question directly by default.",
    "- Use relevant memory, project history, world notes, and historical anchors when they matter.",
    "- Use web search for current, recent, local, factual, or hard-to-verify questions.",
    "- If the context is missing, ask one focused follow-up question instead of guessing.",
    "- Do not turn every question into a memory or context check.",
    "- Only ask for more context when it is truly needed to answer well.",
    "- Do not force the user to use commands or patterns; accept natural language questions first.",
    "",
    "Voice-ready behavior:",
    "- Keep replies breath-friendly and paced for text-to-speech.",
    "- Prefer short to medium sentences.",
    "- Avoid dense punctuation and overcomplicated structure.",
    "",
    "Safety and certainty:",
    "- Do not invent memories, project facts, or world events.",
    "- Do not overstate certainty.",
    "- If a question is broad, answer from general knowledge first and use web search when needed.",
    "- If the user wants a direct answer, give it instead of redirecting back to the conversation state.",
    "- If a topic is biblical or historical, answer naturally and only search if the question needs verification.",
    "- Keep command execution safe and confirm before sensitive actions.",
  ].join("\n"));

  cachedPrompt = `${profile}\n\n${runtime}`.trim();

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
        content: text,
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

function shouldUseWebLookup(query) {
  const normalized = normalizeSearchText(query);
  if (!normalized) {
    return false;
  }

  if (
    /^(hi|hello|hey|thanks|thank you|good morning|good afternoon|good evening|how are you|what can you do|who are you|what is your name)$/i.test(
      normalized,
    )
  ) {
    return false;
  }

  return /(\b(latest|current|recent|today|news|sports|score|scores|result|results|weather|price|prices|stock|stocks|election|update|event|events|this year|last year|year\b)\b|\b(19|20)\d{2}\b)/i.test(
    normalized,
  );
}

function shouldForceFreshWebLookup(query) {
  const normalized = normalizeSearchText(query);
  if (!normalized) {
    return false;
  }

  return /(\bnews update\b|\bnews today\b|\btoday's news\b|\bnews for today\b|\bworld news\b|\bworld update\b|\bworld updates\b|\bcurrent events\b|\blatest news\b|\blatest update\b|\bwhat's new\b|\bwhat is new\b|\bthis week\b|\bthis month\b|\bthis year\b|\bcurrent sports\b|\bsports update\b|\bplayer stats\b|\bgoal tally\b|\bgoal count\b|\bscore update\b|\bmatch update\b)/i.test(
    normalized,
  );
}

function shouldPreferWebSummary(query) {
  const normalized = normalizeSearchText(query);
  if (!normalized) {
    return false;
  }

  return /(\bbrief about\b|\bgive me a brief\b|\btell me about\b|\bwhat happened\b|\bwhat occurred\b|\bwhat took place\b|\bwhat went on\b|\bwhat is\b|\bwho is\b|\bexplain\b|\bwhy is\b|\bwhy are\b|\bhow does\b|\bhow did\b|\bwhen did\b|\bwhat was\b|\bsummary of\b|\btravel\b|\btourism\b|\bvisit\b|\bcountry\b|\bcity\b|\bcapital\b|\bhistory of\b|\bhistorical\b|\bbible\b|\bjesus\b|\bnews about\b|\blatest on\b|\bwhat's happening\b|\bwhat is happening\b|\bgoal tally\b|\bgoals\b|\bgoal\b|\bstats\b|\brecord\b|\bstandings\b|\bpoints\b|\bleague\b|\bmatch\b|\bmatches\b|\bfixture\b|\bfixtures\b|\btable\b|\branking\b|\brank\b|\bteam\b|\bplayer\b|\bplayers\b|\bclub\b|\bseason\b|\btransfer\b|\bappearances\b|\bassists\b|\bcaps\b)/i.test(
    normalized,
  );
}

function isRuntimeTimeQuestion(query) {
  const normalized = normalizeSearchText(query);
  if (!normalized) {
    return false;
  }

  return /(\b(current time|current date|what time is it|what day is it|what date is it|today's date|todays date|right now|now in|time in|date in|day of week|what year is it)\b|\b(now|today|tonight|this morning|this afternoon|this evening)\b)/i.test(
    normalized,
  );
}

function buildRuntimeTimeReply(query) {
  const normalized = normalizeSearchText(query);
  const timeZone = /nairobi|kenya/.test(normalized) ? "Africa/Nairobi" : "UTC";

  try {
    const dateFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      dateStyle: "full",
    });
    const timeFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      timeStyle: "short",
    });

    const now = new Date();
    const dateText = dateFormatter.format(now);
    const timeText = timeFormatter.format(now);
    const dayText = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "long",
    }).format(now);

    if (/what year is it/.test(normalized)) {
      return `It is ${now.getUTCFullYear()} right now.`;
    }

    if (/what day is it|day of week/.test(normalized)) {
      return `It is ${dayText} today.`;
    }

    if (/current date|what date is it|today's date|todays date/.test(normalized)) {
      return `Today's date is ${dateText}.`;
    }

    if (/time in|current time|what time is it|right now|now in/.test(normalized)) {
      return `The current time in ${timeZone === "Africa/Nairobi" ? "Nairobi" : "UTC"} is ${timeText}.`;
    }

    return `Right now it is ${dateText}.`;
  } catch {
    return `Right now it is ${nowIso()}.`;
  }
}

function buildWebSearchQuery(query, state) {
  const text = safeText(query) || getLatestUserMessageText(state);
  if (!text) {
    return "";
  }

  if (/that year|that time|this year|last year|it there|there/i.test(text)) {
    const summary = safeText(state?.conversations?.[0]?.summary);
    if (summary) {
      return `${text} ${summary}`.trim();
    }
  }

  return text;
}

function resolveDuckDuckGoHref(href) {
  const raw = safeText(href);
  if (!raw) {
    return "";
  }

  try {
    const url = new URL(raw, "https://duckduckgo.com");
    const redirected = url.searchParams.get("uddg");
    if (redirected) {
      return decodeURIComponent(redirected);
    }

    if (url.hostname === "duckduckgo.com" && url.pathname === "/l/") {
      return decodeURIComponent(url.searchParams.get("uddg") || "");
    }

    return url.toString();
  } catch {
    return raw;
  }
}

function collectDuckDuckGoTopics(items, results, limit) {
  if (!Array.isArray(items) || !Array.isArray(results)) {
    return;
  }

  for (const item of items) {
    if (results.length >= limit || !item || typeof item !== "object") {
      continue;
    }

    if (safeText(item?.Text)) {
      results.push({
        title: safeText(item?.Text),
        url: resolveDuckDuckGoHref(item?.FirstURL),
        snippet: safeText(item?.Text),
      });
    }

    if (Array.isArray(item?.Topics) && item.Topics.length) {
      collectDuckDuckGoTopics(item.Topics, results, limit);
    }
  }
}

function parseDuckDuckGoHtmlResults(html, limit) {
  const results = [];
  const titlePattern = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = titlePattern.exec(html)) && results.length < limit) {
    const href = resolveDuckDuckGoHref(match[1]);
    const title = cleanSnippet(match[2]);
    const slice = html.slice(match.index, Math.min(html.length, match.index + 2200));
    const snippetMatch = slice.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    const snippet = cleanSnippet(snippetMatch?.[1]);

    if (!title && !snippet) {
      continue;
    }

    results.push({
      title: title || snippet,
      url: href,
      snippet,
    });
  }

  return results;
}

function formatWebContextLine(result) {
  if (!result || typeof result !== "object") {
    return "";
  }

  const title = cleanSnippet(result.title);
  const snippet = cleanSnippet(result.snippet);
  const source = cleanSnippet(result.url);

  if (!title && !snippet) {
    return "";
  }

  const parts = [];
  if (title) {
    parts.push(title);
  }

  if (snippet && snippet !== title) {
    parts.push(snippet);
  }

  let line = parts.join(": ");
  if (source) {
    line = line ? `${line} (${source})` : source;
  }

  return line.trim();
}

async function fetchWebContext(state, userMessage) {
  const query = buildWebSearchQuery(userMessage, state);
  if (!shouldUseWebLookup(query) && !shouldPreferWebSummary(query) && !shouldForceFreshWebLookup(query)) {
    return [];
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WEB_LOOKUP_TIMEOUT_MS);

  try {
    const instantUrl = new URL("https://api.duckduckgo.com/");
    instantUrl.searchParams.set("q", query);
    instantUrl.searchParams.set("format", "json");
    instantUrl.searchParams.set("no_html", "1");
    instantUrl.searchParams.set("skip_disambig", "1");
    instantUrl.searchParams.set("no_redirect", "1");

    const results = [];
    const instantResponse = await fetch(instantUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "Elyra/1.0",
      },
      signal: controller.signal,
    });

    const instantPayload = await instantResponse.json().catch(() => null);
    if (instantResponse.ok && instantPayload) {
      const heading = cleanSnippet(instantPayload?.Heading);
      const abstractText = cleanSnippet(instantPayload?.AbstractText);
      const abstractUrl = resolveDuckDuckGoHref(instantPayload?.AbstractURL);

      if (heading || abstractText) {
        results.push({
          title: heading || "Quick answer",
          url: abstractUrl,
          snippet: abstractText || heading,
        });
      }

      collectDuckDuckGoTopics(Array.isArray(instantPayload?.RelatedTopics) ? instantPayload.RelatedTopics : [], results, WEB_LOOKUP_RESULT_LIMIT);
    }

    if (results.length < WEB_LOOKUP_RESULT_LIMIT) {
      const htmlUrl = new URL("https://html.duckduckgo.com/html/");
      htmlUrl.searchParams.set("q", query);

      const htmlResponse = await fetch(htmlUrl, {
        method: "GET",
        headers: {
          Accept: "text/html",
          "User-Agent": "Elyra/1.0",
        },
        signal: controller.signal,
      });

      const html = await htmlResponse.text();
      if (htmlResponse.ok && html) {
        const htmlResults = parseDuckDuckGoHtmlResults(html, WEB_LOOKUP_RESULT_LIMIT);
        for (const result of htmlResults) {
          const key = `${safeText(result.title)}|${safeText(result.url)}|${safeText(result.snippet)}`;
          const duplicate = results.some((entry) => `${safeText(entry.title)}|${safeText(entry.url)}|${safeText(entry.snippet)}` === key);
          if (!duplicate) {
            results.push(result);
          }
          if (results.length >= WEB_LOOKUP_RESULT_LIMIT) {
            break;
          }
        }
      }
    }

    return results
      .slice(0, WEB_LOOKUP_RESULT_LIMIT)
      .map(formatWebContextLine)
      .filter(Boolean);
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildContextBlock(state, userMessage, options = {}) {
  const query = safeText(userMessage) || getLatestUserMessageText(state);
  const webLines = Array.isArray(options?.webLines) ? options.webLines : [];
  const sections = [
    "You are Elyra, a realistic personal AI assistant.",
    "Answer the user's latest request directly.",
    "Stay calm, natural, and useful.",
    "Keep replies concise unless the user asks for detail.",
    "If something is missing, ask one focused question instead of guessing.",
    `Current runtime date and time: ${formatRuntimeTime()}.`,
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

  if (webLines.length) {
    sections.push(
      [
        "Relevant live web context:",
        ...webLines.map((line) => `- ${line}`),
        "Use this live context for current events, sports, news, and factual lookups. Prefer it over memory when they conflict.",
      ].join("\n"),
    );
  }

  return sections.join("\n\n");
}

function buildLocalContextBlock(state, userMessage, webLines = []) {
  const query = safeText(userMessage) || getLatestUserMessageText(state);
  const sections = [
    "You are Elyra, a realistic personal AI assistant.",
    "Answer the user's latest request directly.",
    "Stay calm, natural, and useful.",
    "Keep replies concise unless the user asks for detail.",
    "Use live web context when present for current or factual questions.",
    `Current runtime date and time: ${formatRuntimeTime()}.`,
  ];

  if (query) {
    sections.push(`Latest user request:\n- ${truncate(query, 180)}`);
  }

  const conversationSummary = safeText(state?.conversations?.[0]?.summary);
  if (conversationSummary) {
    sections.push(`Conversation summary:\n- ${truncate(conversationSummary, 140)}`);
  }

  const memoryLines = buildMemoryLines(state, query).slice(0, 2);
  if (memoryLines.length) {
    sections.push(`Relevant memory:\n${memoryLines.join("\n")}`);
  }

  if (webLines.length) {
    sections.push(
      [
        "Relevant live web context:",
        ...webLines.map((line) => `- ${line}`),
        "Use this live context for current events, sports, news, and factual lookups. Prefer it over memory when they conflict.",
      ].join("\n"),
    );
  }

  return sections.join("\n\n");
}

function buildWebFallbackReply(userMessage, webLines) {
  const lines = Array.isArray(webLines)
    ? webLines.map((line) => safeText(line)).filter(Boolean).slice(0, WEB_LOOKUP_RESULT_LIMIT)
    : [];

  if (!lines.length) {
    return "";
  }

  const topic = safeText(userMessage);
  const intro = topic ? `I found some live context for "${truncate(topic, 80)}":` : "I found some live context:";
  return [intro, ...lines.map((line) => `- ${line}`), "If you want, I can narrow this down or turn it into a cleaner summary."].join("\n");
}

function buildInputMessages(state, userMessage, usePreviousResponse) {
  const developerMessage = {
    role: "developer",
    content: buildContextBlock(state, userMessage),
  };

  if (usePreviousResponse) {
    const text = safeText(userMessage) || getLatestUserMessageText(state);
    return text
      ? [
          developerMessage,
          {
            role: "user",
            content: text,
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

function buildLocalInputMessages(state, userMessage, webLines = []) {
  const systemMessage = {
    role: "system",
    content: buildLocalContextBlock(state, userMessage, webLines),
  };

  const recentMessages = normalizeMessages(Array.isArray(state?.messages) ? state.messages.slice(-4) : []);
  return [systemMessage, ...recentMessages];
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

function getAssistantProvider() {
  if (ASSISTANT_PROVIDER === "openai" || ASSISTANT_PROVIDER === "ollama") {
    return ASSISTANT_PROVIDER;
  }

  return safeText(process.env.OPENAI_API_KEY) ? "openai" : "ollama";
}

async function generateOpenAIReply({ state, userMessage }) {
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

async function generateLocalReply({ state, userMessage }) {
  if (isRuntimeTimeQuestion(userMessage)) {
    return {
      reply: buildRuntimeTimeReply(userMessage),
      model: "runtime",
      reasoningEffort: "time",
      responseId: "",
    };
  }

  const preflightController = new AbortController();
  const preflightTimeoutId = setTimeout(() => preflightController.abort(), LOCAL_MODEL_CHECK_TIMEOUT_MS);
  let selectedModelName = LOCAL_MODEL_NAME;

  try {
    const tagsResponse = await fetch(LOCAL_MODEL_TAGS_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: preflightController.signal,
    });

    const tagsPayload = await tagsResponse.json().catch(() => null);
    if (!tagsResponse.ok) {
      const message = safeText(tagsPayload?.error || tagsPayload?.message) || `Local model check failed with status ${tagsResponse.status}`;
      throw new Error(message);
    }

    const models = Array.isArray(tagsPayload?.models) ? tagsPayload.models : [];
    const modelNames = models.map((model) => safeText(model?.name || model?.model)).filter(Boolean);
    selectedModelName =
      LOCAL_MODEL_PREFERENCES.find((candidate) => modelNames.includes(candidate)) ||
      modelNames[0] ||
      LOCAL_MODEL_NAME;

    if (!selectedModelName) {
      throw new Error(
        `No local Ollama model is ready yet. Wait for Ollama to finish pulling a model, or run: ollama pull ${LOCAL_MODEL_NAME}`,
      );
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        `Local model check timed out. Make sure Ollama is running and one of the local models is pulled.`,
      );
    }

    throw error;
  } finally {
    clearTimeout(preflightTimeoutId);
  }

  const webLines = await fetchWebContext(state, userMessage);
  if ((shouldUseWebLookup(userMessage) || shouldForceFreshWebLookup(userMessage)) && !webLines.length) {
    return {
      reply:
        "I can't reach live web results right now, so I don't want to guess on that one. Ask me again later, or narrow it to a general question I can answer from memory.",
      model: selectedModelName,
      reasoningEffort: "local-web",
      responseId: "",
    };
  }

  if (
    webLines.length &&
    (shouldUseWebLookup(userMessage) || shouldPreferWebSummary(userMessage) || shouldForceFreshWebLookup(userMessage))
  ) {
    const fallbackReply = buildWebFallbackReply(userMessage, webLines);
    if (fallbackReply) {
      return {
        reply: fallbackReply,
        model: selectedModelName,
        reasoningEffort: "local-web",
        responseId: "",
      };
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOCAL_MODEL_TIMEOUT_MS);

  try {
    const response = await fetch(LOCAL_MODEL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: selectedModelName,
        messages: buildLocalInputMessages(state, userMessage, webLines),
        stream: false,
        options: {
          temperature: 0.5,
          num_predict: 180,
        },
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = safeText(payload?.error || payload?.message) || `Local model request failed with status ${response.status}`;
      throw new Error(message);
    }

    const reply = safeText(payload?.message?.content || payload?.response || payload?.output_text || payload?.reply);
    if (!reply) {
      throw new Error("Local model returned an empty assistant reply");
    }

    return {
      reply,
      model: selectedModelName,
      reasoningEffort: "local",
      responseId: safeText(payload?.id),
    };
  } catch (error) {
    if (error?.name === "AbortError" && webLines.length) {
      return {
        reply: buildWebFallbackReply(userMessage, webLines),
        model: selectedModelName,
        reasoningEffort: "local-web",
        responseId: "",
      };
    }

    if (error?.name === "AbortError") {
      throw new Error(`Local model timed out. Start Ollama and make sure a local model is available.`);
    }

    if (webLines.length) {
      const fallbackReply = buildWebFallbackReply(userMessage, webLines);
      if (fallbackReply) {
        return {
          reply: fallbackReply,
          model: selectedModelName,
          reasoningEffort: "local-web",
          responseId: "",
        };
      }
    }

    throw new Error(
      `Local model unavailable at ${LOCAL_MODEL_URL}. Start Ollama and pull ${LOCAL_MODEL_NAME} before chatting.`,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

async function generateAssistantReply({ state, userMessage }) {
  const provider = getAssistantProvider();
  if (provider === "ollama") {
    return generateLocalReply({ state, userMessage });
  }

  return generateOpenAIReply({ state, userMessage });
}

module.exports = {
  generateAssistantReply,
  loadSystemPrompt,
  extractResponseText,
};
