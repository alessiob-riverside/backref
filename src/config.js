// Shared config layer. Exposes BackrefConfig on the global of whatever
// context loads it (service worker, content script, options page).
//
// Effective config is merged from two storage areas:
//   - chrome.storage.managed: admin-pushed via enterprise policy. Read-only.
//     Schema is src/schema.json.
//   - chrome.storage.sync: user-edited via the options page.
//
// Merge rules:
//   - rules:        managed first, then user. lockRules=true → managed only.
//   - hosts:        managed unioned with user (deduped). lockHosts=true → managed only.
//   - openInNewTab: managed wins if explicitly set, else user, else default.
//
// If neither managed nor user supplies anything, DEFAULT_CONFIG fills in.
// Returned object includes a _managed sub-object so the options UI can render
// admin-set entries as read-only.

(function (global) {
  const DEFAULT_CONFIG = {
    rules: [
      {
        regex: "\\b[A-Z]+-[0-9]+\\b",
        template: "https://example.com/issue/{id}"
      }
    ],
    openInNewTab: true,
    hosts: ["github.com"]
  };

  async function readManaged() {
    try {
      return (await chrome.storage.managed.get()) || {};
    } catch (_e) {
      return {};
    }
  }

  async function readUser() {
    try {
      const stored = await chrome.storage.sync.get("config");
      return stored.config || {};
    } catch (_e) {
      return {};
    }
  }

  function arr(x) {
    return Array.isArray(x) ? x : [];
  }

  // Accepts a bare hostname or hostname/path. Path component is anything that
  // isn't a query/fragment/whitespace. Examples that pass:
  //   github.com         github.com/myorg         github.com/myorg/repo/*
  // Examples that fail: github.com?x=1   github.com#x   github.com/with space
  const HOST_ENTRY_RE =
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(\/[^?#\s]*)?$/i;

  // Parse a user host entry into { host, path }. Returns null if malformed.
  // `path` includes the leading "/" or is "" for hostname-only entries.
  function parseHostEntry(entry) {
    if (typeof entry !== "string") return null;
    const trimmed = entry.trim().toLowerCase();
    if (!HOST_ENTRY_RE.test(trimmed)) return null;
    const slash = trimmed.indexOf("/");
    if (slash === -1) return { host: trimmed, path: "" };
    return { host: trimmed.slice(0, slash), path: trimmed.slice(slash) };
  }

  // Convert a user host entry to a Chrome/Firefox match pattern. The trailing
  // "/*" is appended so a path entry like "github.com/myorg" matches everything
  // under that prefix. Returns null if the entry is malformed.
  function hostEntryToMatchPattern(entry) {
    const parsed = parseHostEntry(entry);
    if (!parsed) return null;
    let path = parsed.path;
    if (path.endsWith("*")) path = path.slice(0, -1);
    if (path.endsWith("/")) path = path.slice(0, -1);
    return path === ""
      ? `*://${parsed.host}/*`
      : `*://${parsed.host}${path}/*`;
  }

  // True if the given URL falls within the given host entry. Path comparison is
  // case-insensitive: GitHub's org/repo paths are effectively case-insensitive
  // and matching that user expectation matters more than HTTP-spec strictness.
  function urlMatchesHostEntry(url, entry) {
    const parsed = parseHostEntry(entry);
    if (!parsed) return false;
    let u;
    try {
      u = new URL(url);
    } catch (_e) {
      return false;
    }
    if (u.hostname.toLowerCase() !== parsed.host) return false;
    if (parsed.path === "") return true;
    let path = parsed.path;
    if (path.endsWith("*")) path = path.slice(0, -1);
    if (path.endsWith("/")) path = path.slice(0, -1);
    const urlPath = u.pathname.toLowerCase();
    return urlPath === path || urlPath.startsWith(path + "/");
  }

  // True if `entries` is empty/missing (treated as "no filter, applies
  // everywhere") or any entry matches the URL.
  function urlMatchesAnyHostEntry(url, entries) {
    if (!Array.isArray(entries) || entries.length === 0) return true;
    for (const e of entries) {
      if (urlMatchesHostEntry(url, e)) return true;
    }
    return false;
  }

  function dedupeHosts(list) {
    const seen = new Set();
    const out = [];
    for (const h of list) {
      if (!seen.has(h)) {
        seen.add(h);
        out.push(h);
      }
    }
    return out;
  }

  function mergeConfig(managed, user) {
    const managedRules = arr(managed.rules);
    const managedHosts = arr(managed.hosts);
    const userRules = arr(user.rules);
    const userHosts = arr(user.hosts);

    const lockRules = !!managed.lockRules;
    const lockHosts = !!managed.lockHosts;

    let rules;
    if (lockRules) {
      rules = managedRules.slice();
    } else if (managedRules.length > 0) {
      rules = [...managedRules, ...userRules];
    } else {
      rules = userRules.length > 0 ? userRules.slice() : DEFAULT_CONFIG.rules.slice();
    }

    let hosts;
    if (lockHosts) {
      hosts = managedHosts.slice();
    } else if (managedHosts.length > 0) {
      hosts = dedupeHosts([...managedHosts, ...userHosts]);
    } else {
      hosts = userHosts.length > 0 ? userHosts.slice() : DEFAULT_CONFIG.hosts.slice();
    }

    const managedOpenInNewTab =
      typeof managed.openInNewTab === "boolean" ? managed.openInNewTab : null;
    const openInNewTab =
      managedOpenInNewTab !== null
        ? managedOpenInNewTab
        : typeof user.openInNewTab === "boolean"
          ? user.openInNewTab
          : DEFAULT_CONFIG.openInNewTab;

    return {
      rules,
      hosts,
      openInNewTab,
      _managed: {
        rules: managedRules,
        hosts: managedHosts,
        openInNewTab: managedOpenInNewTab,
        lockRules,
        lockHosts
      }
    };
  }

  async function loadEffectiveConfig() {
    const [managed, user] = await Promise.all([readManaged(), readUser()]);
    return mergeConfig(managed, user);
  }

  global.BackrefConfig = {
    DEFAULT_CONFIG,
    loadEffectiveConfig,
    mergeConfig,
    parseHostEntry,
    hostEntryToMatchPattern,
    urlMatchesHostEntry,
    urlMatchesAnyHostEntry
  };

  // Make pure helpers importable from Node so they can be unit-tested.
  // Browser/service-worker contexts have no `module`, so this is a no-op there.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      DEFAULT_CONFIG,
      loadEffectiveConfig,
      mergeConfig,
      parseHostEntry,
      hostEntryToMatchPattern,
      urlMatchesHostEntry,
      urlMatchesAnyHostEntry
    };
  }
})(typeof self !== "undefined" ? self : globalThis);
