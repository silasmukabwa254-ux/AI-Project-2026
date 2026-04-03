const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

// Use localhost automatically during local development.
// The hosted backend URL remains the default for GitHub Pages.
window.AI_PROJECT_CONFIG = window.AI_PROJECT_CONFIG || {
  apiBaseUrl: isLocalHost ? "" : "https://ai-project-2026-production.up.railway.app",
};
