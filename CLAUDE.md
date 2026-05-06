# Backref

Cross-browser extension (Chrome + Firefox, Manifest V3) that finds bug-tracker IDs on GitHub pages and turns them into clickable links to an external tracker (e.g. Linear, Jira). Project slug: `backref`.

## What it does

For each user-defined rule (regex + link template with `{id}` placeholder), the extension scans matching text inside specific containers and wraps matches in `<a>` tags. Already-linked text is skipped.

Scanned containers (in `src/content.js`):

- `.pl-c` — syntax-highlighted code comments (line and block) in file view and diffs
- `.markdown-body` — rendered markdown: PR/issue descriptions, conversation comments, inline review comments
- `.commit-title`, `.commit-desc` — commit message on commit pages

If GitHub renames or restructures these classes, update `TARGET_SELECTORS` in `src/content.js`.

## Project layout

```
src/             shared extension code (content + background + options).
                 100% reusable across Chrome and Firefox — no per-browser
                 conditionals. Uses chrome.* APIs which Firefox aliases.
manifests/
  chrome.json    Chrome MV3 manifest. service_worker background.
  firefox.json   Firefox MV3 manifest. background.scripts (event page) and
                 browser_specific_settings.gecko.id.
icons/           Extension icons (16, 48, 128 px PNG, plus the 128 source).
scripts/
  build.sh       Stages and packages each browser's bundle into build/.
docs/
  PUBLISHING-CHROME.md
  PUBLISHING-FIREFOX.md
build/           gitignored. Output of scripts/build.sh — one subdir per
                 browser, plus zip artifacts.
```

There is no manifest-level `content_scripts` entry. All content-script registration is dynamic from the service worker / background script, driven by the host list in storage. The host list is the single source of truth for where the extension runs.

## Build / dev workflow

```sh
./scripts/build.sh build all      # stages build/chrome and build/firefox
./scripts/build.sh build chrome   # one browser only
./scripts/build.sh package all    # plus zips for store submission
./scripts/build.sh clean
```

To load unpacked:

- Chrome: `chrome://extensions` → Developer mode → Load unpacked → `build/chrome`
- Firefox: `about:debugging` → This Firefox → Load Temporary Add-on → `build/firefox/manifest.json`

After config changes, links update on the next page navigation; the storage listener also re-scans the current page.

## Config schema (chrome.storage.sync key `config`)

```js
{
  rules: [
    { regex: "\\b[A-Z]+-[0-9]+\\b", template: "https://linear.app/your-org/issue/{id}/" }
  ],
  openInNewTab: true,
  hosts: ["github.com"]
}
```

- `rules[].regex` is a JS regex source string. The whole match is the link text — capture groups are ignored. `{id}` in the template is replaced with the URL-encoded match.
- `hosts` are bare hostnames, expanded to `*://<host>/*` match patterns. The default `github.com` is covered by manifest `host_permissions`; additional hosts go through `chrome.permissions.request` from the options page (must be a user gesture).

## Managed storage (enterprise policy)

For org-wide rollout, admins can push config via `chrome.storage.managed`. The schema is `src/schema.json` and the manifest declares it under `storage.managed_schema`. Top-level keys (NOT nested under `config`):

```js
{
  rules:        [{ regex, template }, ...],   // admin-pushed rules
  hosts:        ["github.example.com", ...],  // admin-pushed hosts
  openInNewTab: true,                          // overrides user preference
  lockRules:    false,                         // true → user cannot add rules
  lockHosts:    false                          // true → user cannot add hosts
}
```

Effective config is merged in `src/config.js` (`loadEffectiveConfig`):

- `rules`: managed first, then user. `lockRules` → managed only.
- `hosts`: managed unioned with user (deduped). `lockHosts` → managed only.
- `openInNewTab`: managed wins if explicitly set.
- Fallback to `DEFAULT_CONFIG` when neither side supplies anything.

The options page renders managed entries as read-only with a "Set by your organization" badge and persists only user-controlled fields back to `chrome.storage.sync`.

Deployment paths:

- **Chrome (Workspace admin console)**: push the JSON keyed by extension ID. Combine with `ExtensionInstallForcelist` to auto-install and `ExtensionSettings` → `runtime_allowed_hosts` to pre-grant host permissions (skips the per-host user prompt).
- **Firefox (`policies.json` or GPO)**: use the `3rdparty.Extensions.<gecko.id>` block for managed config. `ExtensionSettings` with `default_area: "managed"` and the install URL handles forced install. This also bypasses the toolbar host-grant prompt that Firefox MV3 normally requires.

## Browser-specific notes

**Firefox MV3 host permissions are user-grantable, not auto-granted.** After install the user has to grant access to `github.com` via the toolbar permission prompt. Chrome auto-grants declared `host_permissions` on install. Our background script's `chrome.permissions.contains` check before registering content scripts handles this naturally — the extension just sits idle until the user grants access.

**Background context.** Chrome MV3 uses a service worker (`background.service_worker`); Firefox MV3 uses an event page (`background.scripts`). Our `src/background.js` doesn't use service-worker-specific features (no `self.addEventListener("install")`, no `event.waitUntil`), so it works in both contexts. Don't add such APIs without guarding for Firefox.

**AMO submission requires a unique `browser_specific_settings.gecko.id`.** The current value in `manifests/firefox.json` is a placeholder.

## Adding behaviors

- **Skip a region** that's accidentally being processed: tighten a target selector or add an early-out in `processContainer` based on an ancestor class.
- **Process more regions** (e.g. issue titles): add the selector to `TARGET_SELECTORS` and verify GitHub's markup with the inspector. Be wary of regions that are themselves inside `<a>` (commit messages in a commit list, for instance) — the ancestor-is-link check will skip them, which may or may not be what you want.
- **Capture-group support in templates** (`$1`, `$2`): would require switching `findRuleForMatch` to track which alternation branch matched and re-running that rule's regex on the match. Currently out of scope to keep templates simple.
- **Per-host rules**: not supported. All rules apply on all configured hosts.

## Testing

There is no automated test suite. Manual verification:

1. Build and load the extension in Chrome and Firefox (see "Build / dev workflow").
2. Open a public repo PR with code comments and review comments containing your test pattern (e.g. `LIV-123` in a JSDoc block).
3. Verify links appear in: file view comments, diff view comments, PR description, conversation comments, inline review comments, commit page title and body.
4. Check that pre-existing markdown links aren't double-linked.
5. Navigate around (PR → Files → Conversation) without reloading — Turbo navigation should keep links working.

## Known limitations

- Regexes are user-supplied and can produce false positives (`[A-Z]+-[0-9]+` would match `GET-200` in code). The default rule includes `\b` boundaries; users can refine.
- The set of target selectors is a best-effort match against current GitHub markup. GitHub ships new UI shells periodically (e.g. the React-based blob view) and may change classes; the selectors are the first place to look when something stops working.
- Icons in `icons/` are downscaled from a 128×128 source. For a polished release, redraw at 16/48/128 (or render from a 1024 master) so the small sizes stay crisp.
