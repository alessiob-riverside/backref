#!/usr/bin/env bash
# Stages and packages per-browser bundles into build/<browser>/.
# Usage: ./scripts/build.sh <command> [browser]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="$ROOT/build"

usage() {
  cat <<EOF
Usage: $(basename "$0") <command> [browser]

Commands:
  build    [chrome|firefox|all]   Stage build/<browser>/
  package  [chrome|firefox|all]   Build, then zip into build/backref-<browser>.zip
  clean                           Remove build/

Default browser is "all".
EOF
  exit 1
}

build_one() {
  local browser="$1"
  local out="$BUILD/$browser"
  local manifest="$ROOT/manifests/$browser.json"
  if [ ! -f "$manifest" ]; then
    echo "error: manifest not found at $manifest" >&2
    exit 1
  fi
  echo "→ build/$browser"
  rm -rf "$out"
  mkdir -p "$out"
  cp -R "$ROOT/src" "$out/"
  if [ -d "$ROOT/icons" ]; then
    cp -R "$ROOT/icons" "$out/"
  fi
  cp "$manifest" "$out/manifest.json"
}

package_one() {
  local browser="$1"
  build_one "$browser"
  local out="$BUILD/$browser"
  local zip="$BUILD/backref-$browser.zip"
  rm -f "$zip"
  echo "→ $zip"
  (cd "$out" && zip -rq "$zip" . -x ".*")
}

run_for() {
  local action="$1"
  local target="${2:-all}"
  case "$target" in
    chrome|firefox) "${action}_one" "$target" ;;
    all)
      "${action}_one" chrome
      "${action}_one" firefox
      ;;
    *) usage ;;
  esac
}

cmd="${1:-}"
shift || true
case "$cmd" in
  build)   run_for build "$@" ;;
  package) run_for package "$@" ;;
  clean)   rm -rf "$BUILD"; echo "Removed $BUILD" ;;
  ""|-h|--help) usage ;;
  *) usage ;;
esac
