# Backref

Browser extension that turns bug-tracker IDs on GitHub pages into clickable links — across code comments, PR/issue descriptions, comments, and commit messages.

You define rules (regex + URL template) in the extension's options page. Every match becomes a link to your tracker. Already-linked text is left alone.

Available for **Chrome** and **Firefox** (Manifest V3).

## What gets linked

- Code comments in file view and diffs (syntax-highlighted comment tokens)
- PR and issue descriptions
- PR conversation comments and inline review comments
- Commit message title and body on commit pages

## Install

<!-- TODO add Chrome Web Store and AMO listing links once published -->

For now, install from source — see [Build locally](#build-locally) below.

## Configure

Open the extension's options page:

- Chrome: `chrome://extensions` → the extension card → **Details** → **Extension options**
- Firefox: `about:addons` → the extension → **Preferences**

Then:

- Add **link rules** as regex + URL template pairs. Use `{id}` in the template to insert the matched text — e.g. regex `\b[A-Z]+-[0-9]+\b`, template `https://linear.app/your-org/issue/{id}/`. The whole match becomes the link text; capture groups are ignored.
- Add additional **hosts** (e.g. a GitHub Enterprise domain). The browser will prompt for permission.
- Toggle **open in new tab**.

## Build locally

Requires Bash and `zip` (both available out of the box on macOS and Linux; on Windows use WSL or Git Bash).

```sh
./scripts/build.sh build all      # stage build/chrome and build/firefox
./scripts/build.sh package all    # plus zips for store submission
./scripts/build.sh build chrome   # one browser only
./scripts/build.sh clean
```

Then load unpacked:

- **Chrome**: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `build/chrome/`.
- **Firefox**: `about:debugging` → **This Firefox** → **Load Temporary Add-on…** → select `build/firefox/manifest.json`. After loading, click the toolbar icon and grant access to `github.com` — Firefox MV3 makes declared host permissions opt-in per host.

## Project layout

```
src/             shared content/background/options code (works in both browsers)
manifests/       per-browser manifest.json (chrome.json, firefox.json)
icons/           extension icons
scripts/         build script
docs/            publishing instructions
```

## Publishing

- [Chrome Web Store](docs/PUBLISHING-CHROME.md)
- [Firefox AMO and self-hosted XPI](docs/PUBLISHING-FIREFOX.md)

## Contributing

Issues and PRs welcome. The codebase is small — `src/content.js` does the DOM scanning, `src/background.js` registers content scripts based on configured hosts, `src/options.*` is the settings UI. See [CLAUDE.md](CLAUDE.md) for an architectural overview.

## License

<!-- TODO add a LICENSE file before announcing the repo. MIT and Apache-2.0 are common picks for browser extensions. -->
