function safeText(value) {
  return String(value ?? "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function truncate(text, limit = 90) {
  const value = safeText(text);
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function escapeHtml(value) {
  return safeText(value).replace(/[&<>"']/g, (character) => {
    const escapeMap = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return escapeMap[character] || character;
  });
}

function rewriteBrandingText(value) {
  return safeText(value)
    .replaceAll("AI Project 2026", "Elyra")
    .replaceAll("AI Assistant 2026", "Elyra")
    .replaceAll("Assistant 2026", "Elyra");
}

module.exports = {
  safeText,
  nowIso,
  createId,
  truncate,
  escapeHtml,
  rewriteBrandingText,
};
