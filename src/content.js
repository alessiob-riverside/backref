// Content script: scans target containers for bug-tracker IDs and replaces them
// with links. Idempotent — already-linked text is skipped via ancestor check.

(function () {
  const TARGET_SELECTORS = [
    ".pl-c",          // syntax-highlighted code comments (line and block)
    ".markdown-body", // rendered markdown: PR/issue descriptions and comments
    ".commit-title",  // commit title on commit page
    ".commit-desc"    // commit description body on commit page
  ];
  const TARGET_SELECTOR = TARGET_SELECTORS.join(",");
  const LINK_CLASS = "ghst-link";

  let compiledRules = [];      // [{regex: string, template: string, compiled: RegExp}]
  let combinedRegex = null;    // global regex over all rule sources, ORed
  let openInNewTab = true;

  function compileConfig(config) {
    compiledRules = [];
    combinedRegex = null;
    openInNewTab = config.openInNewTab !== false;
    const valid = [];
    for (const r of config.rules || []) {
      if (!r || !r.regex || !r.template) continue;
      try {
        const compiled = new RegExp(`^(?:${r.regex})$`);
        const hosts = Array.isArray(r.hosts) ? r.hosts.slice() : null;
        valid.push({ regex: r.regex, template: r.template, hosts, compiled });
      } catch (_e) {
        // skip invalid regex
      }
    }
    if (valid.length === 0) return;
    try {
      combinedRegex = new RegExp(valid.map(r => `(?:${r.regex})`).join("|"), "g");
      compiledRules = valid;
    } catch (_e) {
      combinedRegex = null;
      compiledRules = [];
    }
  }

  function findRuleForMatch(matchText) {
    const url = location.href;
    for (const r of compiledRules) {
      if (!r.compiled.test(matchText)) continue;
      if (!self.BackrefConfig.urlMatchesAnyHostEntry(url, r.hosts)) continue;
      return r;
    }
    return null;
  }

  function buildLink(matchText, rule) {
    const a = document.createElement("a");
    a.href = rule.template.replace(/\{id\}/g, encodeURIComponent(matchText));
    a.textContent = matchText;
    a.className = LINK_CLASS;
    if (openInNewTab) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    return a;
  }

  function isWithinLink(node) {
    let n = node.parentNode;
    while (n) {
      if (n.nodeType === 1 && n.tagName === "A") return true;
      n = n.parentNode;
    }
    return false;
  }

  function isInTargetContainer(node) {
    const parent = node.nodeType === 3 ? node.parentElement : node.parentElement;
    if (!parent) return false;
    return !!parent.closest(TARGET_SELECTOR);
  }

  function processTextNode(textNode) {
    if (!combinedRegex) return;
    const text = textNode.nodeValue;
    if (!text) return;
    if (isWithinLink(textNode)) return;

    combinedRegex.lastIndex = 0;
    const matches = [];
    let m;
    while ((m = combinedRegex.exec(text)) !== null) {
      if (m[0].length === 0) {
        combinedRegex.lastIndex++;
        continue;
      }
      matches.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    }
    if (matches.length === 0) return;

    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const match of matches) {
      if (match.start > cursor) {
        frag.appendChild(document.createTextNode(text.slice(cursor, match.start)));
      }
      const rule = findRuleForMatch(match.text);
      if (rule) {
        frag.appendChild(buildLink(match.text, rule));
      } else {
        frag.appendChild(document.createTextNode(match.text));
      }
      cursor = match.end;
    }
    if (cursor < text.length) {
      frag.appendChild(document.createTextNode(text.slice(cursor)));
    }
    if (textNode.parentNode) {
      textNode.parentNode.replaceChild(frag, textNode);
    }
  }

  function processContainer(container) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        if (isWithinLink(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    for (const node of nodes) processTextNode(node);
  }

  function processSubtree(root) {
    if (!combinedRegex) return;
    if (root.nodeType === 1) {
      // Process the node itself if it matches
      if (root.matches && root.matches(TARGET_SELECTOR)) {
        processContainer(root);
      }
      // Process descendants that match
      const found = root.querySelectorAll ? root.querySelectorAll(TARGET_SELECTOR) : [];
      for (const el of found) processContainer(el);
      // Process the node if it sits inside a target container
      // (e.g. an inserted span inside an existing .markdown-body)
      if (
        root.parentElement &&
        root.parentElement.closest &&
        root.parentElement.closest(TARGET_SELECTOR) &&
        !(root.matches && root.matches(TARGET_SELECTOR))
      ) {
        processContainer(root);
      }
    } else if (root.nodeType === 3) {
      if (isInTargetContainer(root) && !isWithinLink(root)) {
        processTextNode(root);
      }
    }
  }

  function scanDocument() {
    if (!combinedRegex) return;
    const containers = document.querySelectorAll(TARGET_SELECTOR);
    for (const c of containers) processContainer(c);
  }

  // Debounce mutation handling so bursts of DOM changes coalesce.
  let pendingNodes = new Set();
  let scheduled = false;
  function scheduleProcess(node) {
    pendingNodes.add(node);
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const batch = pendingNodes;
      pendingNodes = new Set();
      for (const n of batch) {
        if (!n.isConnected) continue;
        processSubtree(n);
      }
    });
  }

  const observer = new MutationObserver(mutations => {
    if (!combinedRegex) return;
    for (const m of mutations) {
      for (const added of m.addedNodes) {
        scheduleProcess(added);
      }
      // Character data changes: re-process the parent if in target.
      if (m.type === "characterData" && m.target) {
        scheduleProcess(m.target);
      }
    }
  });

  function start() {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
    scanDocument();
  }

  async function loadAndStart() {
    const config = await self.BackrefConfig.loadEffectiveConfig();
    compileConfig(config);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  }

  chrome.storage.onChanged.addListener(async (_changes, area) => {
    if (area !== "sync" && area !== "managed") return;
    const config = await self.BackrefConfig.loadEffectiveConfig();
    compileConfig(config);
    scanDocument();
  });

  loadAndStart();
})();
