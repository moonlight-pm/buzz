#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
verify="${repo_root}/scripts/verify-release-ref.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

git -C "$tmp" init -q
git -C "$tmp" config user.name test
git -C "$tmp" config user.email test@example.com
echo first >"$tmp/file"
git -C "$tmp" add file
git -C "$tmp" commit -qm first
git -C "$tmp" tag -m "desktop release" desktop-v1.2.3

(
  cd "$tmp"
  GITHUB_REF=refs/tags/desktop-v1.2.3 "$verify" desktop-v 1.2.3
)

if (
  cd "$tmp"
  GITHUB_REF=refs/heads/main "$verify" desktop-v 1.2.3
); then
  echo "branch-backed desktop release was accepted" >&2
  exit 1
fi

echo second >>"$tmp/file"
git -C "$tmp" commit -qam second
if (
  cd "$tmp"
  GITHUB_REF=refs/tags/desktop-v1.2.3 "$verify" desktop-v 1.2.3
); then
  echo "release accepted HEAD after the tag commit" >&2
  exit 1
fi

git -C "$tmp" tag -m "relay release" relay-v2.0.0
(
  cd "$tmp"
  GITHUB_REF=refs/tags/relay-v2.0.0 "$verify" relay-v 2.0.0
)

if grep -q 'inputs\.ref' \
  "$repo_root/.github/workflows/release.yml" \
  "$repo_root/.github/workflows/docker.yml"; then
  echo "publisher workflow still accepts a caller-selected source ref" >&2
  exit 1
fi

grep -q 'verify-release-ref\.sh' "$repo_root/.github/workflows/release.yml"
grep -q 'verify-release-ref\.sh' "$repo_root/.github/workflows/docker.yml"
grep -q 'test-release-ref-contract\.sh' "$repo_root/.github/workflows/ci.yml"
"$repo_root/scripts/test-signed-canary-contract.sh"
"$repo_root/scripts/test-desktop-release-cache-key.sh"
"$repo_root/scripts/test-desktop-release-cache-workflow.sh"
auto_tag="$repo_root/.github/workflows/auto-tag-on-release-pr-merge.yml"
grep -q 'actions/create-github-app-token@' "$auto_tag"
grep -q 'client-id:.*vars\.BUZZ_RELEASE_TAGGER_CLIENT_ID' "$auto_tag"
grep -q 'private-key:.*secrets\.BUZZ_RELEASE_TAGGER_PRIVATE_KEY' "$auto_tag"
grep -q 'permission-contents: write' "$auto_tag"
grep -q 'GH_TOKEN:.*steps\.release-tagger\.outputs\.token' "$auto_tag"
grep -Fq 'git/refs' "$auto_tag"
grep -Fq 'TAG_PREFIX="desktop-v"' "$auto_tag"
grep -Fq 'target_sha=${{ github.event.pull_request.head.sha }}' "$auto_tag"
grep -Fq 'scripts/verify-desktop-release-merge.sh' "$auto_tag"
grep -Fq 'reviewed candidate' "$repo_root/scripts/prepare-desktop-release.sh"
if grep -Fq 'current `main`' "$repo_root/scripts/prepare-desktop-release.sh"; then
  echo "desktop release PR body contains executable command substitution" >&2
  exit 1
fi
required_check_filter="$repo_root/scripts/required-check-succeeded.jq"
check_fixture() {
  local expected="$1" conclusion="$2" app="${3:-15368}" started="${4:-2026-01-01T00:00:00Z}"
  local payload actual
  payload=$(jq -n --arg conclusion "$conclusion" --argjson app "$app" --arg started "$started"     '{check_runs: [{name: "Web", app: {id: $app}, status: "completed", conclusion: $conclusion, started_at: $started, completed_at: $started}]}')
  if jq -e --arg name Web --argjson integration_id 15368     --arg merged_at 2026-01-02T00:00:00Z     -f "$required_check_filter" <<<"[$payload]" >/dev/null; then actual=pass; else actual=fail; fi
  [[ "$actual" == "$expected" ]] || { echo "required-check fixture expected $expected, got $actual" >&2; exit 1; }
}
check_fixture pass success
check_fixture pass skipped
check_fixture pass neutral
check_fixture fail failure
check_fixture fail success 999
check_fixture fail success 15368 2026-01-03T00:00:00Z
# A check that started before merge but completed afterward was not green at merge.
jq -e --arg name Web --argjson integration_id 15368 --arg merged_at 2026-01-02T00:00:00Z \
  -f "$required_check_filter" >/dev/null <<'JSON' && {
[{"check_runs":[{"name":"Web","app":{"id":15368},"status":"completed","conclusion":"success","started_at":"2026-01-01T00:00:00Z","completed_at":"2026-01-03T00:00:00Z"}]}]
JSON
  echo "required-check filter accepted a check that completed after merge" >&2; exit 1;
}
# A null completion timestamp cannot prove success at merge.
jq -e --arg name Web --argjson integration_id 15368 --arg merged_at 2026-01-02T00:00:00Z \
  -f "$required_check_filter" >/dev/null <<'JSON' && {
[{"check_runs":[{"name":"Web","app":{"id":15368},"status":"completed","conclusion":"success","started_at":"2026-01-01T00:00:00Z","completed_at":null}]}]
JSON
  echo "required-check filter accepted a null completion time" >&2; exit 1;
}
# DCO may report just after merge, but only inside its explicit five-minute bound.
dco_fixture() {
  local expected="$1" completed="$2" actual
  if jq -e --arg name "DCO Check" --argjson integration_id 1455659 --arg merged_at 2026-01-02T00:00:00Z \
    -f "$required_check_filter" >/dev/null <<JSON
[{"check_runs":[{"name":"DCO Check","app":{"id":1455659},"status":"completed","conclusion":"success","started_at":"$completed","completed_at":"$completed"}]}]
JSON
  then actual=pass; else actual=fail; fi
  [[ "$actual" == "$expected" ]] || { echo "DCO completion $completed expected $expected" >&2; exit 1; }
}
dco_fixture pass 2026-01-02T00:04:59Z
dco_fixture fail 2026-01-02T00:05:01Z
# Post-merge reruns cannot replace the state that authorized the merge.
jq -e --arg name Web --argjson integration_id 15368   --arg merged_at 2026-01-02T00:00:00Z   -f "$required_check_filter" >/dev/null <<'JSON' || {
[{"check_runs":[
  {"name":"Web","app":{"id":15368},"status":"completed","conclusion":"success","started_at":"2026-01-01T00:00:00Z","completed_at":"2026-01-01T01:00:00Z"},
  {"name":"Web","app":{"id":15368},"status":"completed","conclusion":"failure","started_at":"2026-01-03T00:00:00Z","completed_at":"2026-01-03T01:00:00Z"}
]}]
JSON
  echo "required-check filter did not preserve merge-time success" >&2; exit 1;
}
release_workflow="$repo_root/.github/workflows/release.yml"
[[ "$(grep -c 'contents: write' "$release_workflow")" -eq 1 ]] || {
  echo "desktop release must have exactly one GitHub contents writer" >&2; exit 1;
}
grep -Fq "needs.release.result == 'success'" "$release_workflow"
grep -Fq "needs.release-macos-x64.result == 'success'" "$release_workflow"
grep -Fq "needs.release-linux.result == 'success'" "$release_workflow"
grep -Fq "needs.release-windows.result == 'success'" "$release_workflow"
grep -Fq "refs/tags/desktop-v{0}" "$release_workflow"
grep -Fq "if: \${{ !contains(needs.setup.outputs.version, '-') }}" "$release_workflow"
if grep -Fq "env.already_published != 'true' && !contains(needs.setup.outputs.version, '-')" "$release_workflow"; then
  echo "rolling updater retry is incorrectly gated by versioned publication state" >&2; exit 1
fi
grep -Fq 'group: desktop-release-${{ github.ref }}' "$release_workflow"
grep -Fq 'cancel-in-progress: false' "$release_workflow"
grep -Fq 'release artifact basename collision' "$release_workflow"
[[ "$(grep -c 'gh release upload' "$release_workflow")" -eq 2 ]] || {
  echo "only the final writer may upload versioned and rolling release assets" >&2; exit 1;
}
grep -Fq 'if: env.already_published' "$release_workflow"
grep -Fq 'if gh api "repos/$GITHUB_REPOSITORY/git/ref/tags/$TAG" --silent 2>/dev/null; then' "$auto_tag"
if grep -F 'git/ref/tags/$TAG' "$auto_tag" | grep -Fq '|| true'; then
  echo "auto-tag ignores a failed tag lookup, so a 404 body can look like an existing tag" >&2
  exit 1
fi
if grep -q 'gh workflow run' "$auto_tag"; then
  echo "auto-tag still dispatches a publisher instead of using the tag push" >&2
  exit 1
fi

echo "release ref contract passed"
