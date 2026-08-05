import assert from "node:assert/strict";
import test from "node:test";

import {
  clearCommunityDestinations,
  communityDestinationFromRoute,
  destinationsEqual,
  loadCommunityDestination,
  removeCommunityDestination,
  saveCommunityDestination,
  threadRootIdFromLocationSearch,
} from "./communityNavigationStorage.ts";

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  };
}

test("saves independent Home and channel destinations by community", () => {
  const storage = createMemoryStorage();

  saveCommunityDestination(
    "alpha",
    { kind: "channel", channelId: "general" },
    storage,
  );
  saveCommunityDestination("bravo", { kind: "home" }, storage);

  assert.deepEqual(loadCommunityDestination("alpha", storage), {
    kind: "channel",
    channelId: "general",
  });
  assert.deepEqual(loadCommunityDestination("bravo", storage), {
    kind: "home",
  });
});

test("persists optional threadRootId on channel destinations", () => {
  const storage = createMemoryStorage();

  saveCommunityDestination(
    "alpha",
    {
      kind: "channel",
      channelId: "general",
      threadRootId: "root-event-1",
    },
    storage,
  );

  assert.deepEqual(loadCommunityDestination("alpha", storage), {
    kind: "channel",
    channelId: "general",
    threadRootId: "root-event-1",
  });

  saveCommunityDestination(
    "alpha",
    { kind: "channel", channelId: "general" },
    storage,
  );
  assert.deepEqual(loadCommunityDestination("alpha", storage), {
    kind: "channel",
    channelId: "general",
  });
});

test("persists location destinations for settings and agents", () => {
  const storage = createMemoryStorage();
  saveCommunityDestination(
    "alpha",
    { kind: "location", pathname: "/settings", search: "section=updates" },
    storage,
  );
  assert.deepEqual(loadCommunityDestination("alpha", storage), {
    kind: "location",
    pathname: "/settings",
    search: "section=updates",
  });
});

test("ignores malformed stored destinations", () => {
  const storage = createMemoryStorage({
    "buzz-community-destinations": JSON.stringify({
      valid: { kind: "channel", channelId: "general" },
      withThread: {
        kind: "channel",
        channelId: "general",
        threadRootId: "abc",
      },
      emptyThread: {
        kind: "channel",
        channelId: "general",
        threadRootId: "",
      },
      emptyChannel: { kind: "channel", channelId: "" },
      badLocation: { kind: "location", pathname: "relative" },
      unknown: { kind: "settings" },
      primitive: "home",
    }),
  });

  assert.deepEqual(loadCommunityDestination("valid", storage), {
    kind: "channel",
    channelId: "general",
  });
  assert.deepEqual(loadCommunityDestination("withThread", storage), {
    kind: "channel",
    channelId: "general",
    threadRootId: "abc",
  });
  assert.equal(loadCommunityDestination("emptyThread", storage), null);
  assert.equal(loadCommunityDestination("emptyChannel", storage), null);
  assert.equal(loadCommunityDestination("badLocation", storage), null);
  assert.equal(loadCommunityDestination("unknown", storage), null);
  assert.equal(loadCommunityDestination("primitive", storage), null);
});

test("recovers from invalid JSON", () => {
  const storage = createMemoryStorage({
    "buzz-community-destinations": "not-json",
  });

  assert.equal(loadCommunityDestination("alpha", storage), null);
  saveCommunityDestination("alpha", { kind: "home" }, storage);
  assert.deepEqual(loadCommunityDestination("alpha", storage), {
    kind: "home",
  });
});

test("removes one destination without disturbing another", () => {
  const storage = createMemoryStorage();
  saveCommunityDestination("alpha", { kind: "home" }, storage);
  saveCommunityDestination(
    "bravo",
    { kind: "channel", channelId: "random" },
    storage,
  );

  removeCommunityDestination("alpha", storage);

  assert.equal(loadCommunityDestination("alpha", storage), null);
  assert.deepEqual(loadCommunityDestination("bravo", storage), {
    kind: "channel",
    channelId: "random",
  });
});

test("clears all destinations", () => {
  const storage = createMemoryStorage();
  saveCommunityDestination("alpha", { kind: "home" }, storage);

  clearCommunityDestinations(storage);

  assert.equal(storage.length, 0);
});

test("communityDestinationFromRoute maps home, channel, settings, agents", () => {
  assert.deepEqual(
    communityDestinationFromRoute({
      pathname: "/",
      selectedView: "home",
      selectedChannelId: null,
    }),
    { kind: "home" },
  );
  assert.deepEqual(
    communityDestinationFromRoute({
      pathname: "/channels/c1",
      selectedView: "channel",
      selectedChannelId: "c1",
      threadRootId: "t1",
    }),
    { kind: "channel", channelId: "c1", threadRootId: "t1" },
  );
  assert.deepEqual(
    communityDestinationFromRoute({
      pathname: "/settings",
      selectedView: "home",
      selectedChannelId: null,
      search: { section: "updates" },
    }),
    { kind: "location", pathname: "/settings", search: "section=updates" },
  );
  assert.deepEqual(
    communityDestinationFromRoute({
      pathname: "/agents",
      selectedView: "agents",
      selectedChannelId: null,
    }),
    { kind: "location", pathname: "/agents" },
  );
});

test("threadRootIdFromLocationSearch prefers thread over threadRootId", () => {
  assert.equal(
    threadRootIdFromLocationSearch({ thread: "a", threadRootId: "b" }),
    "a",
  );
  assert.equal(threadRootIdFromLocationSearch({ threadRootId: "b" }), "b");
  assert.equal(threadRootIdFromLocationSearch({}), undefined);
});

test("destinationsEqual compares kind, channel, thread, and location", () => {
  assert.equal(destinationsEqual({ kind: "home" }, { kind: "home" }), true);
  assert.equal(
    destinationsEqual(
      { kind: "channel", channelId: "c", threadRootId: "t" },
      { kind: "channel", channelId: "c", threadRootId: "t" },
    ),
    true,
  );
  assert.equal(
    destinationsEqual(
      { kind: "channel", channelId: "c" },
      { kind: "channel", channelId: "c", threadRootId: "t" },
    ),
    false,
  );
  assert.equal(
    destinationsEqual(
      { kind: "location", pathname: "/agents" },
      { kind: "location", pathname: "/agents" },
    ),
    true,
  );
});
