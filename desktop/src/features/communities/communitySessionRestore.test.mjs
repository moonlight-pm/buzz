import assert from "node:assert/strict";
import test from "node:test";

import {
  isChannelRestorable,
  isRestorableShellPath,
  locationDestinationHref,
  planCommunitySessionRestore,
  serializeSearchForDestination,
} from "./communitySessionRestore.ts";

test("isRestorableShellPath allows known shell routes and forum posts", () => {
  assert.equal(isRestorableShellPath("/agents"), true);
  assert.equal(isRestorableShellPath("/settings"), true);
  assert.equal(isRestorableShellPath("/workflows/abc"), true);
  assert.equal(
    isRestorableShellPath("/channels/c1/posts/p1"),
    true,
  );
  assert.equal(isRestorableShellPath("/channels/c1"), false);
  assert.equal(isRestorableShellPath("/evil"), false);
});

test("plan: cold start on home restores channel", () => {
  assert.deepEqual(
    planCommunitySessionRestore({
      pendingRestore: false,
      selectedView: "home",
      pathname: "/",
      destination: { kind: "channel", channelId: "c1", threadRootId: "t1" },
      channelAvailable: true,
    }),
    { action: "channel", channelId: "c1", threadRootId: "t1" },
  );
});

test("plan: deep link wins over saved destination", () => {
  assert.deepEqual(
    planCommunitySessionRestore({
      pendingRestore: false,
      selectedView: "agents",
      pathname: "/agents",
      destination: { kind: "channel", channelId: "c1" },
      channelAvailable: true,
    }),
    { action: "none" },
  );
});

test("plan: missing channel clears to home", () => {
  assert.deepEqual(
    planCommunitySessionRestore({
      pendingRestore: false,
      selectedView: "home",
      pathname: "/",
      destination: { kind: "channel", channelId: "gone" },
      channelAvailable: false,
    }),
    { action: "home", clearSaved: true },
  );
});

test("plan: already on target channel after community switch is a no-op", () => {
  assert.deepEqual(
    planCommunitySessionRestore({
      pendingRestore: true,
      selectedView: "channel",
      pathname: "/channels/c1",
      destination: { kind: "channel", channelId: "c1", threadRootId: "t1" },
      channelAvailable: true,
    }),
    { action: "none" },
  );
});

test("plan: restores location destinations from home", () => {
  assert.deepEqual(
    planCommunitySessionRestore({
      pendingRestore: false,
      selectedView: "home",
      pathname: "/",
      destination: {
        kind: "location",
        pathname: "/settings",
        search: "section=updates",
      },
      channelAvailable: false,
    }),
    {
      action: "location",
      pathname: "/settings",
      search: "section=updates",
    },
  );
});

test("plan: rejects unsafe location paths", () => {
  assert.deepEqual(
    planCommunitySessionRestore({
      pendingRestore: false,
      selectedView: "home",
      pathname: "/",
      destination: { kind: "location", pathname: "/not-a-real-route" },
      channelAvailable: false,
    }),
    { action: "home", clearSaved: true },
  );
});

test("isChannelRestorable ignores archived members", () => {
  assert.equal(
    isChannelRestorable("c1", [
      { id: "c1", archivedAt: "2026-01-01" },
      { id: "c2", archivedAt: null },
    ]),
    false,
  );
  assert.equal(
    isChannelRestorable("c2", [
      { id: "c1", archivedAt: "2026-01-01" },
      { id: "c2", archivedAt: null },
    ]),
    true,
  );
});

test("serializeSearchForDestination and href helpers", () => {
  assert.equal(
    serializeSearchForDestination({ thread: "abc", empty: "" }),
    "thread=abc",
  );
  assert.equal(serializeSearchForDestination("?x=1"), "x=1");
  assert.equal(locationDestinationHref("/settings", "section=a"), "/settings?section=a");
  assert.equal(locationDestinationHref("/agents"), "/agents");
});
