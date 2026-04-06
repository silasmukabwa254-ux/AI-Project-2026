const { nowIso } = require("../shared/utils");

class RateLimiter {
  constructor(maxRequests = 30, windowMs = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = new Map();
  }

  isAllowed(identifier) {
    const now = Date.now();
    const key = String(identifier);

    if (!this.requests.has(key)) {
      this.requests.set(key, []);
    }

    const times = this.requests.get(key);
    const recentTimes = times.filter((time) => now - time < this.windowMs);

    if (recentTimes.length >= this.maxRequests) {
      return false;
    }

    recentTimes.push(now);
    this.requests.set(key, recentTimes);
    return true;
  }
}

class SimpleCache {
  constructor(ttlMs = 900000) {
    this.cache = new Map();
    this.ttlMs = ttlMs;
  }

  set(key, value) {
    const expiresAt = Date.now() + this.ttlMs;
    this.cache.set(key, { value, expiresAt });
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  clear() {
    this.cache.clear();
  }
}

class ErrorLogger {
  constructor() {
    this.errors = [];
  }

  log(error, context = {}) {
    const entry = {
      timestamp: nowIso(),
      message: error?.message || String(error),
      stack: error?.stack,
      context,
    };
    this.errors.push(entry);
    if (this.errors.length > 100) {
      this.errors.shift();
    }
    console.error(`[${entry.timestamp}] ${entry.message}`, context);
  }

  getRecent(limit = 20) {
    return this.errors.slice(-limit);
  }
}

module.exports = {
  RateLimiter,
  SimpleCache,
  ErrorLogger,
};
