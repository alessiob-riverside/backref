// Options page logic. Renders the effective config (managed + user), lets the
// user edit their own entries, and requests host permissions on a user gesture
// before persisting host changes. Managed entries are admin-pushed via
// chrome.storage.managed and rendered read-only.

const { DEFAULT_CONFIG } = self.BackrefConfig;

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

const els = {
  hostList: document.getElementById("host-list"),
  hostInput: document.getElementById("host-input"),
  hostInputRow: document.getElementById("host-input-row"),
  addHost: document.getElementById("add-host"),
  hostError: document.getElementById("host-error"),
  hostPolicyNote: document.getElementById("host-policy-note"),
  ruleList: document.getElementById("rule-list"),
  addRule: document.getElementById("add-rule"),
  rulePolicyNote: document.getElementById("rule-policy-note"),
  openInNewTab: document.getElementById("open-in-new-tab"),
  behaviorPolicyNote: document.getElementById("behavior-policy-note"),
  save: document.getElementById("save"),
  status: document.getElementById("status"),
  ruleTemplate: document.getElementById("rule-template"),
  hostTemplate: document.getElementById("host-template")
};

// User-editable state. Managed values live in `managed` and are render-only.
let state = {
  rules: [],
  hosts: [],
  openInNewTab: true,
  managed: {
    rules: [],
    hosts: [],
    openInNewTab: null,
    lockRules: false,
    lockHosts: false
  }
};

const POLICY_BADGE = "Set by your organization";

function setManagedAttrs(node) {
  node.classList.add("managed");
  const badge = document.createElement("span");
  badge.className = "policy-badge";
  badge.textContent = POLICY_BADGE;
  return badge;
}

function renderHosts() {
  els.hostList.replaceChildren();

  for (const host of state.managed.hosts) {
    const node = els.hostTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".host-name").textContent = host;
    const removeBtn = node.querySelector(".remove-host");
    removeBtn.remove();
    node.appendChild(setManagedAttrs(node));
    els.hostList.appendChild(node);
  }

  for (const host of state.hosts) {
    if (state.managed.hosts.includes(host)) continue;
    const node = els.hostTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".host-name").textContent = host;
    node.querySelector(".remove-host").addEventListener("click", async () => {
      state.hosts = state.hosts.filter(h => h !== host);
      renderHosts();
      try {
        await chrome.permissions.remove({ origins: [`*://${host}/*`] });
      } catch (_e) {
        // ignore
      }
    });
    els.hostList.appendChild(node);
  }

  const locked = state.managed.lockHosts;
  els.hostInputRow.hidden = locked;
  if (locked) {
    els.hostPolicyNote.hidden = false;
    els.hostPolicyNote.textContent = "Hosts are managed by your organization.";
  } else if (state.managed.hosts.length > 0) {
    els.hostPolicyNote.hidden = false;
    els.hostPolicyNote.textContent =
      "Hosts marked as managed are set by your organization. You can add your own below.";
  } else {
    els.hostPolicyNote.hidden = true;
  }
}

function renderRules() {
  els.ruleList.replaceChildren();

  for (const rule of state.managed.rules) {
    const node = els.ruleTemplate.content.firstElementChild.cloneNode(true);
    const regexInput = node.querySelector(".rule-regex");
    const templateInput = node.querySelector(".rule-template");
    regexInput.value = rule.regex || "";
    templateInput.value = rule.template || "";
    regexInput.disabled = true;
    templateInput.disabled = true;
    node.querySelector(".remove-rule").remove();
    node.appendChild(setManagedAttrs(node));
    els.ruleList.appendChild(node);
  }

  state.rules.forEach((rule, idx) => {
    const node = els.ruleTemplate.content.firstElementChild.cloneNode(true);
    const regexInput = node.querySelector(".rule-regex");
    const templateInput = node.querySelector(".rule-template");
    regexInput.value = rule.regex;
    templateInput.value = rule.template;
    regexInput.addEventListener("input", () => {
      state.rules[idx].regex = regexInput.value;
    });
    templateInput.addEventListener("input", () => {
      state.rules[idx].template = templateInput.value;
    });
    node.querySelector(".remove-rule").addEventListener("click", () => {
      state.rules.splice(idx, 1);
      renderRules();
    });
    els.ruleList.appendChild(node);
  });

  const locked = state.managed.lockRules;
  els.addRule.hidden = locked;
  if (locked) {
    els.rulePolicyNote.hidden = false;
    els.rulePolicyNote.textContent = "Rules are managed by your organization.";
  } else if (state.managed.rules.length > 0) {
    els.rulePolicyNote.hidden = false;
    els.rulePolicyNote.textContent =
      "Rules marked as managed are set by your organization. You can add your own below.";
  } else {
    els.rulePolicyNote.hidden = true;
  }
}

function renderBehavior() {
  const managedValue = state.managed.openInNewTab;
  if (managedValue !== null) {
    els.openInNewTab.checked = managedValue;
    els.openInNewTab.disabled = true;
    els.behaviorPolicyNote.hidden = false;
    els.behaviorPolicyNote.textContent =
      "Open-in-new-tab is set by your organization.";
  } else {
    els.openInNewTab.checked = state.openInNewTab;
    els.openInNewTab.disabled = false;
    els.behaviorPolicyNote.hidden = true;
  }
}

function setHostError(msg) {
  if (!msg) {
    els.hostError.hidden = true;
    els.hostError.textContent = "";
  } else {
    els.hostError.hidden = false;
    els.hostError.textContent = msg;
  }
}

function setStatus(msg) {
  els.status.textContent = msg;
  if (msg) {
    setTimeout(() => {
      if (els.status.textContent === msg) els.status.textContent = "";
    }, 3000);
  }
}

async function addHost() {
  const raw = els.hostInput.value.trim().toLowerCase();
  setHostError("");
  if (!raw) return;
  if (!HOSTNAME_RE.test(raw)) {
    setHostError("Invalid hostname.");
    return;
  }
  if (state.hosts.includes(raw)) {
    setHostError("Host already added.");
    return;
  }
  if (state.managed.hosts.includes(raw)) {
    setHostError("Host already added (set by your organization).");
    return;
  }
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [`*://${raw}/*`] });
  } catch (e) {
    setHostError(`Permission request failed: ${e.message}`);
    return;
  }
  if (!granted) {
    setHostError("Permission denied — extension will not run on that host.");
    return;
  }
  state.hosts.push(raw);
  els.hostInput.value = "";
  renderHosts();
}

function validateRules() {
  for (const r of state.rules) {
    if (!r.regex || !r.template) {
      return "Each rule needs both a regex and a template.";
    }
    try {
      new RegExp(r.regex);
    } catch (e) {
      return `Invalid regex "${r.regex}": ${e.message}`;
    }
    if (!r.template.includes("{id}")) {
      return `Template "${r.template}" is missing the {id} placeholder.`;
    }
  }
  return null;
}

async function save() {
  const err = validateRules();
  if (err) {
    setStatus(err);
    return;
  }
  // Persist only user fields. openInNewTab is omitted when policy-controlled.
  const config = {
    rules: state.rules.map(r => ({ regex: r.regex, template: r.template })),
    hosts: [...state.hosts]
  };
  if (state.managed.openInNewTab === null) {
    config.openInNewTab = !!els.openInNewTab.checked;
  } else {
    config.openInNewTab = state.openInNewTab;
  }
  await chrome.storage.sync.set({ config });
  setStatus("Saved.");
}

async function load() {
  const effective = await self.BackrefConfig.loadEffectiveConfig();
  const stored = await chrome.storage.sync.get("config");
  const user = stored.config || null;

  state.managed = effective._managed;

  // Build user-editable state. If the user has saved config, use it. Otherwise
  // fall back to defaults — but only when the admin hasn't supplied any rules,
  // so we don't pre-fill duplicates of policy entries.
  if (user) {
    state.rules = Array.isArray(user.rules)
      ? user.rules.map(r => ({ regex: r.regex || "", template: r.template || "" }))
      : [];
    state.hosts = Array.isArray(user.hosts) ? [...user.hosts] : [];
    state.openInNewTab = user.openInNewTab !== false;
  } else if (state.managed.rules.length > 0 || state.managed.hosts.length > 0) {
    state.rules = [];
    state.hosts = [];
    state.openInNewTab = true;
  } else {
    state.rules = DEFAULT_CONFIG.rules.map(r => ({ ...r }));
    state.hosts = [...DEFAULT_CONFIG.hosts];
    state.openInNewTab = DEFAULT_CONFIG.openInNewTab;
  }

  renderHosts();
  renderRules();
  renderBehavior();
}

els.addHost.addEventListener("click", addHost);
els.hostInput.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    addHost();
  }
});
els.addRule.addEventListener("click", () => {
  state.rules.push({ regex: "", template: "" });
  renderRules();
});
els.save.addEventListener("click", save);

// React to managed-policy updates while the options page is open.
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "managed") load();
});

load();
