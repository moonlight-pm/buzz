#!/usr/bin/env bash
# Moonlight Desktop — signed + notarized Apple Silicon build.
#
# Secrets live on the self-hosted runner only (never in git / never Block keys):
#   ~/.buzz/.secrets/moonlight-desktop.env
#
# Usage:
#   scripts/moonlight/build-desktop-macos.sh [--version X.Y.Z] [--out DIR]
#
# Outputs under --out (default: desktop/dist/moonlight):
#   Buzz_<ver>_aarch64.app.tar.gz
#   Buzz_<ver>_aarch64.app.tar.gz.sig
#   Buzz_<ver>_aarch64.dmg
#   BUILD_INFO.txt
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

VERSION=""
OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:?}"
      shift 2
      ;;
    --out)
      OUT="${2:?}"
      shift 2
      ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

export PATH="/Users/joshua/.cargo/bin:/opt/homebrew/bin:${PATH}"

# Hermit toolchains when present
if [[ -f bin/activate-hermit ]]; then
  # shellcheck disable=SC1091
  source bin/activate-hermit
fi

ENV_FILE="${MOONLIGHT_DESKTOP_ENV:-$HOME/.buzz/.secrets/moonlight-desktop.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing machine-local env: $ENV_FILE" >&2
  echo "Expected Apple + Tauri updater vars on the self-hosted runner only." >&2
  exit 1
fi
# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

required=(
  APPLE_SIGNING_IDENTITY
  APPLE_API_KEY
  APPLE_API_ISSUER
  APPLE_API_KEY_PATH
  BUZZ_UPDATER_PUBLIC_KEY
  BUZZ_UPDATER_ENDPOINT
)
for v in "${required[@]}"; do
  if [[ -z "${!v:-}" ]]; then
    echo "Missing required env: $v (from $ENV_FILE)" >&2
    exit 1
  fi
done
if [[ ! -f "$APPLE_API_KEY_PATH" ]]; then
  echo "APPLE_API_KEY_PATH not found: $APPLE_API_KEY_PATH" >&2
  exit 1
fi

# Prefer key file path for Tauri signer; export body if only path is set
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" && -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" && -f "${TAURI_SIGNING_PRIVATE_KEY_PATH}" ]]; then
  TAURI_SIGNING_PRIVATE_KEY="$(cat "$TAURI_SIGNING_PRIVATE_KEY_PATH")"
  export TAURI_SIGNING_PRIVATE_KEY
fi
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  echo "Missing TAURI_SIGNING_PRIVATE_KEY (or PATH) in $ENV_FILE" >&2
  exit 1
fi

# Guard: updater must point at Moonlight, never upstream Block
case "$BUZZ_UPDATER_ENDPOINT" in
  *moonlight-pm*|*moonlight.pm*)
    ;;
  *)
    echo "Refusing build: BUZZ_UPDATER_ENDPOINT is not Moonlight: $BUZZ_UPDATER_ENDPOINT" >&2
    exit 1
    ;;
esac

export CMAKE_POLICY_VERSION_MINIMUM="${CMAKE_POLICY_VERSION_MINIMUM:-3.5}"
export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-10.15}"
export CMAKE_OSX_DEPLOYMENT_TARGET="${CMAKE_OSX_DEPLOYMENT_TARGET:-10.15}"
export TAURI_BUNDLER_DMG_IGNORE_CI="${TAURI_BUNDLER_DMG_IGNORE_CI:-true}"
export APPLE_SIGNING_IDENTITY
export APPLE_API_KEY
export APPLE_API_ISSUER
export APPLE_API_KEY_PATH
export BUZZ_UPDATER_PUBLIC_KEY
export BUZZ_UPDATER_ENDPOINT
export TAURI_SIGNING_PRIVATE_KEY
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

if [[ -x ./scripts/ensure-mesh-native-runtime.sh ]]; then
  export MESH_LLM_NATIVE_RUNTIME_CACHE_DIR
  MESH_LLM_NATIVE_RUNTIME_CACHE_DIR="$(./scripts/ensure-mesh-native-runtime.sh)"
fi

# Real sidecars (not stubs)
./scripts/bundle-sidecars.sh

if [[ -n "$VERSION" ]]; then
  (cd desktop && node scripts/set-version-from-tag.mjs "$VERSION")
  (cd desktop/src-tauri && cargo update --workspace 2>/dev/null || true)
fi

VERSION="$(node -p "require('./desktop/package.json').version")"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid desktop version: $VERSION" >&2
  exit 1
fi

OUT="${OUT:-$ROOT/desktop/dist/moonlight}"
mkdir -p "$OUT"
rm -f "$OUT"/Buzz_* "$OUT"/BUILD_INFO.txt "$OUT"/latest.json 2>/dev/null || true

(cd desktop && node scripts/build-release-config.mjs)

echo "=== Moonlight desktop build v${VERSION} @ $(git rev-parse --short HEAD) ==="
set +e
(cd desktop && pnpm tauri build \
  --features mesh-llm \
  --target aarch64-apple-darwin \
  --config src-tauri/tauri.release.conf.json)
BUILD_RC=$?
set -e

APP="$ROOT/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Buzz.app"
if [[ ! -d "$APP" ]]; then
  echo "Build failed (rc=$BUILD_RC) and Buzz.app missing" >&2
  exit "${BUILD_RC:-1}"
fi

# App should already be signed+notarized by Tauri when APPLE_* env is set
if ! xcrun stapler validate "$APP" >/dev/null 2>&1; then
  echo "App missing staple — submitting for notarization..."
  ZIP="$(mktemp -t BuzzXXXX).zip"
  ditto -c -k --keepParent "$APP" "$ZIP"
  xcrun notarytool submit "$ZIP" \
    --key "$APPLE_API_KEY_PATH" \
    --key-id "$APPLE_API_KEY" \
    --issuer "$APPLE_API_ISSUER" \
    --wait
  xcrun stapler staple "$APP"
  rm -f "$ZIP"
fi

# Updater archive (+ sign)
ARCHIVE="$OUT/Buzz_${VERSION}_aarch64.app.tar.gz"
(
  cd "$(dirname "$APP")"
  tar -czf "$ARCHIVE" Buzz.app
)
(cd desktop && pnpm tauri signer sign "$ARCHIVE")
SIG="${ARCHIVE}.sig"
if [[ ! -f "$SIG" ]]; then
  echo "Missing updater signature: $SIG" >&2
  exit 1
fi

# DMG: prefer Tauri output; else hdiutil fallback (bundle_dmg.sh is flaky in CI)
DMG_SRC="$ROOT/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Buzz_${VERSION}_aarch64.dmg"
DMG="$OUT/Buzz_${VERSION}_aarch64.dmg"
if [[ -f "$DMG_SRC" ]] && xcrun stapler validate "$DMG_SRC" >/dev/null 2>&1; then
  cp -f "$DMG_SRC" "$DMG"
else
  echo "Building DMG via hdiutil fallback..."
  STAGE="$(mktemp -d)"
  cp -R "$APP" "$STAGE/Buzz.app"
  ln -sf /Applications "$STAGE/Applications"
  DMG_RW="$OUT/Buzz_${VERSION}_aarch64.rw.dmg"
  rm -f "$DMG" "$DMG_RW"
  hdiutil create -volname "Buzz" -srcfolder "$STAGE" -ov -format UDRW "$DMG_RW"
  hdiutil convert "$DMG_RW" -format UDZO -imagekey zlib-level=9 -o "$DMG"
  rm -f "$DMG_RW"
  rm -rf "$STAGE"
  codesign --force --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$DMG"
  xcrun notarytool submit "$DMG" \
    --key "$APPLE_API_KEY_PATH" \
    --key-id "$APPLE_API_KEY" \
    --issuer "$APPLE_API_ISSUER" \
    --wait
  xcrun stapler staple "$DMG"
fi

# Verify
codesign --verify --deep --strict "$APP"
xcrun stapler validate "$APP"
xcrun stapler validate "$DMG"
spctl -a -vv --type execute "$APP" 2>&1 | tee /dev/stderr | grep -qi accepted

cat > "$OUT/BUILD_INFO.txt" <<EOF
HEAD=$(git rev-parse HEAD)
VERSION=${VERSION}
BUILT_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
APP_NOTARIZED=yes
DMG_NOTARIZED=yes
UPDATER_ENDPOINT=${BUZZ_UPDATER_ENDPOINT}
REPO=${GITHUB_REPOSITORY:-moonlight-pm/buzz}
EOF

echo "=== Artifacts in $OUT ==="
ls -lah "$OUT"
echo "BUILD_OK version=$VERSION"
