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
    mergeConfig
  };

  // Make pure helpers importable from Node so they can be unit-tested.
  // Browser/service-worker contexts have no `module`, so this is a no-op there.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { DEFAULT_CONFIG, loadEffectiveConfig, mergeConfig };
  }
})(typeof self !== "undefined" ? self : globalThis);
