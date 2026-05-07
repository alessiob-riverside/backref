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

  // GitHub's React-based code view renders visible text in one layer and
  // overlays a transparent <textarea> on top for selection/clipboard. The
  // textarea absorbs mouse events before they reach our injected <a>, so the
  // link looks live but the cursor never changes and clicks do nothing.
  //
  // Two-layer mitigation:
  //   1. CSS — cursor: pointer on the link itself (helps in normal contexts
  //      like PR descriptions; harmless in the code view).
  //   2. JS — a capture-phase click listener that uses elementsFromPoint to
  //      find our <a> underneath whatever absorbed the click and triggers
  //      navigation manually.
  function injectLinkStyles() {
    if (document.getElementById("ghst-style")) return;
    const style = document.createElement("style");
    style.id = "ghst-style";
    // - cursor: pointer on the link itself for normal contexts (PR comments).
    // - .ghst-link-hover class is toggled by JS for the React code view, where
    //   the textarea overlay swallows hover events. Both rules apply the same
    //   subtle background tint so the hover affordance is consistent.
    // - When the user is over a link in the code-view overlay, the textarea
    //   on top is what actually receives hover. We override its cursor only
    //   (NOT every element via "*") to avoid a page-wide style recalc.
    style.textContent = [
      "a." + LINK_CLASS + " { cursor: pointer; }",
      "a." + LINK_CLASS + ":hover, a." + LINK_CLASS + "." + LINK_CLASS + "-hover {",
      "  background-color: rgba(9, 105, 218, 0.12);",
      "  border-radius: 3px;",
      "  text-decoration: underline;",
      "}",
      "html." + LINK_CLASS + "-hover-active textarea,",
      "html." + LINK_CLASS + "-hover-active input {",
      "  cursor: pointer !important;",
      "}"
    ].join("\n");
    (document.head || document.documentElement).appendChild(style);
  }

  // Hover handling. Native :hover doesn't reach our link in views with a
  // textarea overlay, so we synthesise it via mousemove + bounding-rect.
  let hoveredLink = null;
  let pendingPos = null;
  let hoverRafScheduled = false;

  function applyHoverState(x, y) {
    const linkUnder = findLinkAtPoint(x, y);
    if (linkUnder !== hoveredLink) {
      if (hoveredLink) hoveredLink.classList.remove(LINK_CLASS + "-hover");
      if (linkUnder) linkUnder.classList.add(LINK_CLASS + "-hover");
      hoveredLink = linkUnder;
    }
    document.documentElement.classList.toggle(
      LINK_CLASS + "-hover-active",
      !!linkUnder
    );
  }

  function handlePointerMove(e) {
    // Cheap early-out for pages with no matched links — most pages.
    if (document.getElementsByClassName(LINK_CLASS).length === 0) return;
    // Skip if pointer hasn't moved meaningfully since the last check (sub-px
    // jitter from a hand on a high-DPI mouse).
    const x = e.clientX;
    const y = e.clientY;
    if (
      pendingPos &&
      Math.abs(pendingPos.x - x) < 2 &&
      Math.abs(pendingPos.y - y) < 2
    ) {
      pendingPos.x = x;
      pendingPos.y = y;
      return;
    }
    pendingPos = { x, y };
    if (hoverRafScheduled) return;
    hoverRafScheduled = true;
    requestAnimationFrame(() => {
      hoverRafScheduled = false;
      if (pendingPos) applyHoverState(pendingPos.x, pendingPos.y);
    });
  }

  function clearHoverState() {
    if (hoveredLink) {
      hoveredLink.classList.remove(LINK_CLASS + "-hover");
      hoveredLink = null;
    }
    document.documentElement.classList.remove(LINK_CLASS + "-hover-active");
  }

  function navigateLink(link, e) {
    const newTab =
      link.target === "_blank" || e.metaKey || e.ctrlKey || e.button === 1;
    if (newTab) {
      window.open(link.href, "_blank", "noopener,noreferrer");
    } else {
      window.location.href = link.href;
    }
  }

  // Bounding-rect intersection rather than elementsFromPoint, because
  // elementsFromPoint silently filters out elements with pointer-events: none
  // (which can be cascaded onto our link by the host page).
  function findLinkAtPoint(x, y) {
    const links = document.getElementsByClassName(LINK_CLASS);
    if (links.length === 0) return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (const link of links) {
      const rect = link.getBoundingClientRect();
      // Cheap viewport cull — the vast majority of links on a long page are
      // off-screen, so we skip them without computing the inner intersection.
      if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) continue;
      if (rect.width === 0 || rect.height === 0) continue;
      if (
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      ) {
        return link;
      }
    }
    return null;
  }

  function handleClickFallback(e) {
    // Right-click → leave for context menu.
    if (e.button !== 0 && e.button !== 1) return;
    // If the click target is already our link (e.g. in PR descriptions where
    // events reach the <a> normally), the native handler fires — no-op here.
    if (e.target && e.target.closest && e.target.closest("a." + LINK_CLASS)) return;
    // Fast path: if the user just hovered a link before clicking, the click
    // is almost certainly on it — saves a full-list scan that would force
    // layout on every link.
    let link = null;
    if (hoveredLink) {
      const rect = hoveredLink.getBoundingClientRect();
      if (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      ) {
        link = hoveredLink;
      }
    }
    if (!link) link = findLinkAtPoint(e.clientX, e.clientY);
    if (!link) return;
    e.preventDefault();
    e.stopPropagation();
    navigateLink(link, e);
  }

  function start() {
    injectLinkStyles();
    // Window-level capture so we fire before any document/element listener
    // that might call stopImmediatePropagation. Click only — using mousedown
    // would break text selection that starts inside a link.
    window.addEventListener("click", handleClickFallback, true);
    window.addEventListener("auxclick", handleClickFallback, true);
    window.addEventListener("mousemove", handlePointerMove, {
      capture: true,
      passive: true
    });
    document.addEventListener(
      "mouseout",
      e => {
        if (!e.relatedTarget) clearHoverState();
      },
      true
    );
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
