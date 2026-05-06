# Publishing — Firefox

Four ways to ship the Firefox build. Firefox offers more distribution flexibility than Chrome — notably, signed self-hosted XPIs.

## 1. Local install (temporary, for development)

Firefox loads unpacked extensions only as **temporary** add-ons (lost on browser restart). For persistent local install use option 3 (signed self-hosted XPI).

1. Build the Firefox bundle:
   ```sh
   ./scripts/build.sh build firefox
   ```
2. Open `about:debugging`.
3. Click **This Firefox** → **Load Temporary Add-on…**
4. Select `build/firefox/manifest.json`.
5. Click the extension's puzzle-piece icon in the toolbar and **grant access to `github.com`**. Firefox MV3 treats declared `host_permissions` as opt-in per host, so the extension will not run on GitHub until you grant access. (Chrome auto-grants declared host permissions on install — this is a Firefox vs Chrome behavior difference.)
6. Open the options page from `about:addons` → the extension → **Preferences**.

To pick up code changes, run the build again and click **Reload** in `about:debugging`. Content-script changes additionally need a refresh of any open GitHub tabs.

## 2. addons.mozilla.org (AMO) — listed or unlisted

Firefox's official add-on store. The `browser_specific_settings.gecko.id` in `manifests/firefox.json` is the extension's stable identifier — it's permanent once published, so a fork that wants its own listing should change it before submitting.

### Prerequisites

- A free Mozilla account at <https://addons.mozilla.org/developers/>.
- A unique gecko id (already set to `{25afe7bb-f9fb-4b6b-a2ef-43bd2ce6877d}` in `manifests/firefox.json`). The id format is either `name@domain` or a UUID in braces; Mozilla doesn't validate domain ownership but the id must be unique on AMO. Forks should generate their own UUID with `uuidgen`.
- Icons. The repo includes 16/48/128 px PNGs in `icons/`, wired up in `manifests/firefox.json`. Replace before publishing if needed.

### Package

```sh
./scripts/build.sh package firefox
```

Produces `build/backref-firefox.zip`.

### Submit

1. <https://addons.mozilla.org/developers/addon/submit/>
2. Choose visibility:
   - **Listed** — appears on AMO and is discoverable. Required if you want install via the AMO website.
   - **Unlisted** — not on AMO. Mozilla still signs it; you distribute the signed XPI yourself (see option 3). Right pick for org-internal distribution.
3. Upload the zip. Mozilla runs both automated and (sometimes) human review.
4. **Permissions justification** notes — be ready to explain:
   - `storage` — stores user-defined regex/template rules.
   - `scripting` — used to register the content script dynamically based on the user's host list.
   - `host_permissions: *://github.com/*` — runs on the configured default host.
   - `optional_host_permissions: *://*/*` — lets the user opt into GitHub Enterprise hosts via the options page on a user gesture.
5. For listed add-ons, fill in summary, description, screenshots, categories, license. For unlisted, you're done after the upload — review produces a signed XPI.

## 3. Self-hosted signed XPI

Firefox uniquely allows installing a signed XPI hosted anywhere. Use this for private distribution without listing on AMO.

1. Submit as **unlisted** in option 2 above.
2. Once Mozilla signs it, download the signed `.xpi` from your AMO developer dashboard.
3. Host the XPI on a server you control (HTTPS).
4. Users install by visiting the XPI URL in Firefox; they get a permission prompt and one-click install.
5. To enable auto-updates, host an `updates.json` manifest and reference it from `browser_specific_settings.gecko.update_url` in the manifest. See <https://extensionworkshop.com/documentation/manage/updating-your-extension/>.

## 4. Force-install via Firefox Enterprise policy

For managed Firefox deployments (Firefox ESR is common in enterprises).

1. Sign the XPI (option 2 unlisted, or 3).
2. Configure `policies.json` (or Group Policy on Windows) with:
   ```json
   {
     "policies": {
       "ExtensionSettings": {
         "{25afe7bb-f9fb-4b6b-a2ef-43bd2ce6877d}": {
           "installation_mode": "force_installed",
           "install_url": "https://your-host.example/backref.xpi"
         }
       }
     }
   }
   ```
3. Deploy `policies.json` per Mozilla's [enterprise documentation](https://mozilla.github.io/policy-templates/).

## Versioning

Bump `version` in `manifests/firefox.json` for every AMO submission. AMO rejects re-uploads with the same version. Keep in sync with `manifests/chrome.json` if you publish to both stores.

## Pre-release checklist

- gecko id in `manifests/firefox.json` is set (currently `{25afe7bb-f9fb-4b6b-a2ef-43bd2ce6877d}`). Forks should generate their own.
- Default rule template in `src/background.js` (`DEFAULT_CONFIG`) and `src/options.js` (`DEFAULT_CONFIG`) — currently `https://example.com/issue/{id}` — points somewhere real, or the README explains it's a placeholder.
- Version bumped in `manifests/firefox.json`.
- Icons in `icons/` are the final ones, not placeholders.
- `build/firefox/` was rebuilt from clean source: `./scripts/build.sh package firefox`.
