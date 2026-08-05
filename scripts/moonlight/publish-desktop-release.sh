#!/usr/bin/env bash
# Publish Moonlight Desktop artifacts to GitHub Releases + rolling latest.json.
#
# Usage:
#   scripts/moonlight/publish-desktop-release.sh <version> <artifact-dir>
#
# Creates/updates:
#   tag desktop-v<version>-moonlight  (versioned assets)
#   tag buzz-desktop-latest           (rolling latest.json only)
#
# Requires: gh auth, repo write. No Block/upstream credentials.
set -euo pipefail

VERSION="${1:?version required (e.g. 0.5.5)}"
OUT="${2:?artifact dir required}"
REPO="${GITHUB_REPOSITORY:-moonlight-pm/buzz}"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Release version must be pure semver X.Y.Z (no pre-release/metadata): got $VERSION" >&2
  exit 1
fi

ARCHIVE="$OUT/Buzz_${VERSION}_aarch64.app.tar.gz"
SIG="$OUT/Buzz_${VERSION}_aarch64.app.tar.gz.sig"
DMG="$OUT/Buzz_${VERSION}_aarch64.dmg"
for f in "$ARCHIVE" "$SIG" "$DMG"; do
  if [[ ! -f "$f" ]]; then
    echo "Missing artifact: $f" >&2
    exit 1
  fi
done

TAG="desktop-v${VERSION}-moonlight"
LATEST_TAG="buzz-desktop-latest"
BASE="https://github.com/${REPO}/releases/download/${TAG}"
ARCHIVE_URL="${BASE}/Buzz_${VERSION}_aarch64.app.tar.gz"

# Generate latest.json (Moonlight only)
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
"$ROOT/desktop/scripts/generate-oss-latest-json.sh" \
  "$VERSION" \
  "darwin-aarch64:${SIG}:${ARCHIVE_URL}" \
  >"$OUT/latest.json"

echo "=== latest.json ==="
cat "$OUT/latest.json"

NOTES="Buzz Desktop ${VERSION} (Moonlight)

Apple Silicon (aarch64) · Developer ID signed + notarized
Updater channel: ${LATEST_TAG}

Install DMG once for new machines; in-app updates use the Moonlight endpoint baked into this build.
"

# Versioned release
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "Updating existing release $TAG"
  gh release upload "$TAG" "$ARCHIVE" "$SIG" "$DMG" "$OUT/BUILD_INFO.txt" \
    --repo "$REPO" --clobber
else
  gh release create "$TAG" "$ARCHIVE" "$SIG" "$DMG" "$OUT/BUILD_INFO.txt" \
    --repo "$REPO" \
    --title "Buzz Desktop ${VERSION} (Moonlight)" \
    --notes "$NOTES" \
    --latest=false
fi

# Rolling latest.json release (mutable assets)
if gh release view "$LATEST_TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$LATEST_TAG" "$OUT/latest.json" \
    --repo "$REPO" --clobber
  gh release edit "$LATEST_TAG" --repo "$REPO" \
    --notes "Rolling Moonlight desktop updater manifest. Current version: ${VERSION}."
else
  gh release create "$LATEST_TAG" "$OUT/latest.json" \
    --repo "$REPO" \
    --title "Buzz Desktop Auto-Update (Moonlight)" \
    --notes "Rolling Moonlight desktop updater manifest. Current version: ${VERSION}." \
    --prerelease \
    --latest=false
fi

echo "PUBLISH_OK tag=$TAG latest=$LATEST_TAG version=$VERSION"
echo "DMG: ${BASE}/Buzz_${VERSION}_aarch64.dmg"
echo "latest.json: https://github.com/${REPO}/releases/download/${LATEST_TAG}/latest.json"
