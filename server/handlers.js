const { generateAssistantReply } = require("./assistantService");
const { safeText, nowIso, createId } = require("../shared/utils");

function sendJson(res, statusCode, payload, getCorsHeaders) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...getCorsHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2000000) {
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

function createHandlers(db, rateLimiter, errorLogger, getCorsHeaders, normalizeState, readLatestSnapshot, readSnapshotCount, writeSnapshot) {
  return {
    async handleChat(req, res) {
      const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";

      if (!rateLimiter.isAllowed(clientIp)) {
        sendJson(res, 429, {
          ok: false,
          error: "Too many requests. Please wait before sending another message.",
        }, getCorsHeaders);
        return;
      }

      try {
        const body = await readRequestBody(req);
        const message = safeText(body.message);

        if (!message) {
          sendJson(res, 400, {
            ok: false,
            error: "Message is required",
          }, getCorsHeaders);
          return;
        }

        const sourceState = body.state && typeof body.state === "object" ? body.state : readLatestSnapshot().state;
        const nextState = normalizeState(sourceState);
        const lastMessage = nextState.messages[nextState.messages.length - 1];

        if (!lastMessage || lastMessage.role !== "user" || safeText(lastMessage.text) !== message) {
          nextState.messages.push({
            id: createId("msg"),
            role: "user",
            text: message,
            createdAt: nowIso(),
          });
        }

        const reply = await generateAssistantReply({ state: nextState, userMessage: message });

        sendJson(res, 200, {
          ok: true,
          reply: reply.reply,
          meta: {
            model: reply.model,
            reasoningEffort: reply.reasoningEffort,
            responseId: reply.responseId,
          },
        }, getCorsHeaders);
      } catch (error) {
        errorLogger.log(error, { endpoint: "/chat", clientIp: req.socket.remoteAddress });
        sendJson(res, 503, {
          ok: false,
          error: error.message || "Assistant unavailable",
        }, getCorsHeaders);
      }
    },

    handleStateGet(res) {
      const latest = readLatestSnapshot();
      sendJson(res, 200, {
        ok: true,
        state: latest.state,
        meta: {
          snapshotId: latest.id,
          reason: latest.reason,
          createdAt: latest.createdAt,
          snapshotCount: readSnapshotCount(),
        },
      }, getCorsHeaders);
    },

    async handleStatePost(req, res) {
      try {
        const body = await readRequestBody(req);
        const nextState = normalizeState(body.state || body);
        const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : "client-sync";
        const snapshot = writeSnapshot(nextState, reason);

        sendJson(res, 200, {
          ok: true,
          state: snapshot.state,
          meta: {
            snapshotId: snapshot.id,
            reason: snapshot.reason,
            snapshotCount: readSnapshotCount(),
          },
        }, getCorsHeaders);
      } catch (error) {
        errorLogger.log(error, { endpoint: "/state", method: "POST" });
        sendJson(res, 400, {
          ok: false,
          error: error.message || "Unable to save state",
        }, getCorsHeaders);
      }
    },

    handleHealth(res) {
      const latest = readLatestSnapshot();
      sendJson(res, 200, {
        ok: true,
        status: "sqlite-backed",
        snapshotCount: readSnapshotCount(),
        latestSnapshotAt: latest.createdAt,
      }, getCorsHeaders);
    },

    handleOptions(res) {
      res.writeHead(204, {
        ...getCorsHeaders(),
        "Cache-Control": "no-store",
      });
      res.end();
    },
  };
}

module.exports = {
  createHandlers,
  sendJson,
  readRequestBody,
};
