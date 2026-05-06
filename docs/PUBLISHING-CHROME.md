# Publishing — Chrome Web Store

Three ways to ship the Chrome build. Pick the one that matches your situation.

## 1. Local install (development / single user)

No publishing required.

1. Build the Chrome bundle:
   ```sh
   ./scripts/build.sh build chrome
   ```
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select `build/chrome/`.
5. Open the options page from the extension card → **Details** → **Extension options**.

To pick up code changes, run the build again and click the **Reload** icon on the extension's card. Content-script changes additionally need a refresh of any open GitHub tabs.

## 2. Chrome Web Store — public, unlisted, or private listing

### Prerequisites

- A Chrome Web Store **developer account**. One-time **\$5 USD** registration fee.
- Icons. The repo includes 16/48/128 px PNGs in `icons/`, already wired up in `manifests/chrome.json`. Replace these before publishing if you want a different mark — the Web Store rejects placeholder-quality icons during review.

### Package

```sh
./scripts/build.sh package chrome
```

This produces `build/backref-chrome.zip` ready for upload.

### Submit

1. <https://chrome.google.com/webstore/devconsole/>
2. **New item** → upload the zip.
3. Store-listing fields:
   - Description, screenshots (1280×800 or 640×400), category.
   - **Privacy practices**: this extension stores config in `chrome.storage.sync` and does not send data anywhere — answer accordingly.
   - **Permissions justification** — be ready to explain:
     - `storage` — stores user-defined regex/template rules.
     - `scripting` — used to register the content script dynamically based on the user's host list.
     - `host_permissions: *://github.com/*` — runs on the configured default host.
     - `optional_host_permissions: *://*/*` — lets the user opt into GitHub Enterprise hosts via the options page; permission is requested through `chrome.permissions.request` on a user gesture.
4. Choose **Visibility**:
   - **Public** — discoverable on the Chrome Web Store.
   - **Unlisted** — accessible only via the listing URL.
   - **Private** — only specific Workspace accounts/groups in your organization can see it. Requires the developer account to be in a Workspace org.
5. Submit. Reviews are typically a few hours to a couple of days.

## 3. Force-install via Chrome Enterprise policy

For managed Chrome browsers in an organization.

1. Publish the extension as above (private listing is fine).
2. Get the extension ID from the Web Store dashboard.
3. Google Admin console: **Devices → Chrome → Apps & extensions → Users & browsers**.
4. Add by ID, set policy to **Force install**, scope to the relevant org units.

## Versioning

Bump `version` in `manifests/chrome.json` for every Web Store upload. The Web Store rejects re-uploads with the same version. Use semantic-ish numbers (`0.1.0`, `0.1.1`, `0.2.0`).

If you also publish the Firefox build, keep version numbers in sync between `manifests/chrome.json` and `manifests/firefox.json`.

## Updating

Re-upload a new zip. Existing installs auto-update within a few hours, or immediately when the user clicks **Update** on `chrome://extensions` with developer mode on.

## Pre-release checklist

- Default rule template in `src/background.js` (`DEFAULT_CONFIG`) and `src/options.js` (`DEFAULT_CONFIG`) — currently the placeholder `https://example.com/issue/{id}` — points somewhere real, or the README explains it's a placeholder.
- Version bumped in `manifests/chrome.json`.
- Icons in `icons/` are the final ones, not placeholders.
- `build/chrome/` was rebuilt from clean source: `./scripts/build.sh package chrome`.
