const { LOCAL_DATA_CACHE_TTL_MS } = require("./constants");

function createLocalDataCache(ttlMs = LOCAL_DATA_CACHE_TTL_MS) {
  const entries = new Map();
  const fileEntries = new Map();

  function invalidate() {
    entries.clear();
    fileEntries.clear();
  }

  // Install the pending read immediately so main and meter share the same I/O.
  // Identity checks prevent an older read from restoring an invalidated value.
  async function memo(map, key, loader) {
    const hit = map.get(key);
    if (hit && (hit.pending || Date.now() < hit.expiresAt)) return hit.pending || hit.value;
    const entry = {};
    map.set(key, entry);
    if (map.size > 24) map.delete(map.keys().next().value);
    entry.pending = (async () => {
      try {
        const value = await loader();
        if (map.get(key) === entry) {
          entry.value = value;
          entry.expiresAt = Date.now() + ttlMs;
          entry.pending = null;
        }
        return value;
      } catch (error) {
        if (map.get(key) === entry) map.delete(key);
        throw error;
      }
    })();
    return entry.pending;
  }

  function getSessionFiles(dir, loader) { return memo(fileEntries, dir, () => loader(dir)); }
  function cached(key, loader) { return memo(entries, key, loader); }

  function buildDashboardKey(scope) {
    return [
      "dashboard",
      scope?.accountId ?? "none",
      scope?.since ?? "all",
      scope?.hasCurrentAuth ? "auth" : "no-auth",
    ].join(":");
  }

  function buildQuotaKey(scope) {
    return ["quota", scope?.accountId ?? "none", scope?.since ?? "all", scope?.hasCurrentAuth ? "auth" : "no-auth"].join(
      ":"
    );
  }

  function buildUsageKey(options) {
    return ["usage", options?.since ?? "all", String(options?.scanLimit ?? "default")].join(":");
  }

  return {
    invalidate,
    getSessionFiles,
    cached,
    buildDashboardKey,
    buildQuotaKey,
    buildUsageKey,
  };
}

module.exports = { createLocalDataCache };
