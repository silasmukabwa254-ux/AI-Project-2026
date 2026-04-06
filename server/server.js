const { createServer } = require("node:http");
const { mkdirSync, existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { RateLimiter, SimpleCache, ErrorLogger } = require("./middleware");
const { safeText, nowIso, createId } = require("../shared/utils");
const { createHandlers } = require("./handlers");

const APP_NAME = process.env.APP_NAME || "Elyra";
const PORT = Number(process.env.PORT || 3001);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "localhost:3000";
const ROOT_DIR = path.resolve(__dirname, "..");
const CLIENT_DIR = path.join(ROOT_DIR, "client");
const DATA_DIR = path.join(__dirname, "data");
const DEFAULT_DB_PATH = path.join(DATA_DIR, "ai-project-2026.sqlite");
const DATABASE_PATH = resolveDatabasePath(process.env.DATABASE_PATH || DEFAULT_DB_PATH);

mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DATABASE_PATH);
const rateLimiter = new RateLimiter(30, 60000);
const webCache = new SimpleCache(900000);
const errorLogger = new ErrorLogger();

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS state_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_json TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

seedDatabaseIfNeeded();

function resolveDatabasePath(value) {
  if (!value) {
    return DEFAULT_DB_PATH;
  }

  return path.isAbsolute(value) ? value : path.resolve(__dirname, value);
}



function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
  };
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
        value: "Warm. Direct. Grounded.",
        updatedAt: now,
      },
      {
        id: createId("mem"),
        label: "Project goal",
        value: "Think, remember, search, and help act.",
        updatedAt: now,
      },
      {
        id: createId("mem"),
        label: "Voice style",
        value: "Short, natural, and easy to speak aloud.",
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

function normalizeState(raw) {
  const base = createDefaultState();

  if (!raw || typeof raw !== "object") {
    return migrateBranding(base);
  }

  return migrateBranding({
    conversations: Array.isArray(raw.conversations) && raw.conversations.length ? raw.conversations : base.conversations,
    memories: Array.isArray(raw.memories) && raw.memories.length ? raw.memories : base.memories,
    history: Array.isArray(raw.history) && raw.history.length ? raw.history : base.history,
    worldUpdates: Array.isArray(raw.worldUpdates) && raw.worldUpdates.length ? raw.worldUpdates : base.worldUpdates,
    worldTimeline: Array.isArray(raw.worldTimeline) && raw.worldTimeline.length ? raw.worldTimeline : base.worldTimeline,
    messages: Array.isArray(raw.messages) && raw.messages.length ? raw.messages : base.messages,
    activity: Array.isArray(raw.activity) && raw.activity.length ? raw.activity : base.activity,
  });
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

function migrateBranding(state) {
  const { rewriteBrandingText } = require("../shared/utils");

  const rewriteEntries = (entries, fields) =>
    entries.map((entry) => {
      if (!entry || typeof entry !== "object") {
        return entry;
      }

      const next = { ...entry };
      for (const field of fields) {
        if (typeof next[field] === "string") {
          next[field] = rewriteBrandingText(next[field]);
        }
      }
      return next;
    });

  return {
    ...state,
    conversations: rewriteEntries(state.conversations || [], ["title", "summary"]),
    memories: rewriteEntries(state.memories || [], ["label", "value"]),
    history: rewriteEntries(state.history || [], ["title", "text"]),
    worldUpdates: rewriteEntries(state.worldUpdates || [], ["title", "text", "region", "source"]),
    worldTimeline: rewriteEntries(state.worldTimeline || [], ["title", "text", "era", "source"]),
    messages: rewriteEntries(state.messages || [], ["text"]),
    activity: rewriteEntries(state.activity || [], ["title", "detail"]),
  };
}

function seedDatabaseIfNeeded() {
  const countRow = db.prepare("SELECT COUNT(*) AS count FROM state_snapshots").get();
  if (countRow && countRow.count > 0) {
    return;
  }

  writeSnapshot(createDefaultState(), "seed");
}

function writeSnapshot(state, reason = "sync") {
  const normalized = normalizeState(state);
  const snapshotJson = JSON.stringify(normalized);

  const result = db
    .prepare(
      "INSERT INTO state_snapshots (snapshot_json, reason, created_at) VALUES (?, ?, ?)",
    )
    .run(snapshotJson, String(reason || "sync"), nowIso());

  return {
    id: result.lastInsertRowid,
    state: normalized,
    reason: String(reason || "sync"),
  };
}

function readLatestSnapshot() {
  const row = db
    .prepare(
      "SELECT id, snapshot_json, reason, created_at FROM state_snapshots ORDER BY id DESC LIMIT 1",
    )
    .get();

  if (!row) {
    return {
      id: 0,
      state: createDefaultState(),
      reason: "seed",
      createdAt: nowIso(),
    };
  }

  try {
    return {
      id: row.id,
      state: normalizeState(JSON.parse(row.snapshot_json)),
      reason: row.reason || "sync",
      createdAt: row.created_at,
    };
  } catch {
    return {
      id: row.id,
      state: createDefaultState(),
      reason: row.reason || "sync",
      createdAt: row.created_at,
    };
  }
}

function readSnapshotCount() {
  const row = db.prepare("SELECT COUNT(*) AS count FROM state_snapshots").get();
  return row ? row.count : 0;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...getCorsHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendText(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    ...getCorsHeaders(),
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function getMimeType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function serveStaticFile(res, filePath) {
  if (!existsSync(filePath)) {
    return false;
  }

  const fileBuffer = readFileSync(filePath);
  res.writeHead(200, {
    ...getCorsHeaders(),
    "Content-Type": getMimeType(filePath),
    "Content-Length": fileBuffer.length,
    "Cache-Control": "no-store",
  });
  res.end(fileBuffer);
  return true;
}

const handlers = createHandlers(
  db,
  rateLimiter,
  errorLogger,
  getCorsHeaders,
  normalizeState,
  readLatestSnapshot,
  readSnapshotCount,
  writeSnapshot,
);

const staticFiles = {
  "/": "index.html",
  "/index.html": "index.html",
  "/style.css": "style.css",
  "/script.js": "script.js",
  "/config.js": "config.js",
};

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === "OPTIONS") {
    handlers.handleOptions(res);
    return;
  }

  if (req.method === "GET" && pathname === "/health") {
    handlers.handleHealth(res);
    return;
  }

  if (req.method === "POST" && pathname === "/chat") {
    void handlers.handleChat(req, res);
    return;
  }

  if (req.method === "GET" && pathname === "/state") {
    handlers.handleStateGet(res);
    return;
  }

  if (req.method === "POST" && pathname === "/state") {
    void handlers.handleStatePost(req, res);
    return;
  }

  if (req.method === "GET" && staticFiles[pathname]) {
    const filePath = path.join(CLIENT_DIR, staticFiles[pathname]);
    if (serveStaticFile(res, filePath)) {
      return;
    }
  }

  sendText(res, 404, "Not found");
});

server.listen(PORT, () => {
  console.log(`${APP_NAME} running at http://localhost:${PORT}`);
  console.log(`SQLite database: ${DATABASE_PATH}`);
});
