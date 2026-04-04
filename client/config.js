const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

// Use the local backend by default so the GitHub Pages UI can talk to
// the private Elyra server running on this machine.
window.AI_PROJECT_CONFIG = window.AI_PROJECT_CONFIG || {
  apiBaseUrl: isLocalHost ? "" : "http://localhost:3001",
};
