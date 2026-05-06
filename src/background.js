// Service worker (Chrome) / event page (Firefox).
// Seeds defaults, registers content scripts when the effective host list
// changes, and re-registers on managed-policy or sync updates.
// Hosts beyond github.com require explicit permission, requested from the
// options page on a user gesture. Enterprise admins can pre-grant via
// ExtensionSettings → runtime_allowed_hosts.

// Make BackrefConfig available. In Chrome MV3 the service worker uses
// importScripts; in Firefox the manifest's background.scripts already loaded
// config.js before this file.
if (typeof BackrefConfig === "undefined" && typeof importScripts === "function") {
  importScripts("./config.js");
}

const SCRIPT_ID = "ghst-content";
const CONTENT_FILES = ["src/config.js", "src/content.js"];

function hostsToMatches(hosts) {
  return (hosts || [])
    .map(h => h.trim())
    .filter(Boolean)
    .map(h => `*://${h}/*`);
}

async function grantedMatches(hosts) {
  const granted = [];
  for (const h of hosts || []) {
    const origin = `*://${h}/*`;
    try {
      const ok = await chrome.permissions.contains({ origins: [origin] });
      if (ok) granted.push(origin);
    } catch (_e) {
      // ignore — host pattern may be invalid
    }
  }
  return granted;
}

async function doSync() {
  const config = await BackrefConfig.loadEffectiveConfig();

  // Always unregister first so removals take effect.
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  } catch (_e) {
    // not registered yet — ignore
  }

  const matches = await grantedMatches(config.hosts);
  if (matches.length === 0) return;

  try {
    await chrome.scripting.registerContentScripts([
      {
        id: SCRIPT_ID,
        js: CONTENT_FILES,
        matches,
        runAt: "document_idle",
        allFrames: false,
        persistAcrossSessions: true
      }
    ]);
  } catch (e) {
    console.error("[backref] failed to register content scripts:", e);
  }
}

// Serialize syncs and coalesce overlapping requests. Multiple events
// (onInstalled, storage.onChanged, permissions.onAdded/Removed) can fire
// concurrently; without serialization the unregister/register pair races
// and the second register fails with "Duplicate script ID".
let syncInFlight = null;
let syncPending = false;
function syncContentScripts() {
  if (syncInFlight) {
    syncPending = true;
    return syncInFlight;
  }
  syncInFlight = (async () => {
    try {
      do {
        syncPending = false;
        await doSync();
      } while (syncPending);
    } finally {
      syncInFlight = null;
    }
  })();
  return syncInFlight;
}

chrome.runtime.onInstalled.addListener(async () => {
  // Only seed user defaults when no managed policy supplies rules; otherwise
  // we'd duplicate the admin's rules with our defaults under the user namespace.
  let managed = {};
  try {
    managed = (await chrome.storage.managed.get()) || {};
  } catch (_e) {
    // no policy
  }
  const hasManagedRules = Array.isArray(managed.rules) && managed.rules.length > 0;
  const { config } = await chrome.storage.sync.get("config");
  if (!config && !hasManagedRules) {
    await chrome.storage.sync.set({ config: BackrefConfig.DEFAULT_CONFIG });
  }
  await syncContentScripts();
});

chrome.runtime.onStartup.addListener(() => {
  syncContentScripts();
});

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "sync" || area === "managed") {
    syncContentScripts();
  }
});

chrome.permissions.onAdded.addListener(() => {
  syncContentScripts();
});
chrome.permissions.onRemoved.addListener(() => {
  syncContentScripts();
});

// Open options page when the toolbar icon is clicked.
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
