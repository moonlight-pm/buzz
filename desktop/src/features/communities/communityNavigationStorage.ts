import { setLocalStorageItemWithRecovery } from "@/shared/lib/localStorageQuota";

const COMMUNITY_DESTINATIONS_KEY = "buzz-community-destinations";
let pendingCommunityRestoreId: string | null = null;

/**
 * Last place the user was inside a community.
 *
 * - `home` — Inbox / Home
 * - `channel` — a channel, optionally with an open thread panel head id
 *
 * Used for community-switch restore (pending flag) and cold-start restore.
 */
export type CommunityDestination =
  | { kind: "home" }
  | { kind: "channel"; channelId: string; threadRootId?: string };

type CommunityDestinations = Record<string, CommunityDestination>;

function isCommunityDestination(value: unknown): value is CommunityDestination {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "home") {
    return true;
  }

  if (
    candidate.kind !== "channel" ||
    typeof candidate.channelId !== "string" ||
    candidate.channelId.length === 0
  ) {
    return false;
  }

  if (candidate.threadRootId === undefined) {
    return true;
  }

  return (
    typeof candidate.threadRootId === "string" &&
    candidate.threadRootId.length > 0
  );
}

function normalizeCommunityDestination(
  destination: CommunityDestination,
): CommunityDestination {
  if (destination.kind === "home") {
    return { kind: "home" };
  }

  if (
    typeof destination.threadRootId === "string" &&
    destination.threadRootId.length > 0
  ) {
    return {
      kind: "channel",
      channelId: destination.channelId,
      threadRootId: destination.threadRootId,
    };
  }

  return { kind: "channel", channelId: destination.channelId };
}

export function destinationsEqual(
  a: CommunityDestination | null | undefined,
  b: CommunityDestination | null | undefined,
): boolean {
  if (a == null || b == null) {
    return a == null && b == null;
  }
  if (a.kind === "home" || b.kind === "home") {
    return a.kind === "home" && b.kind === "home";
  }
  return (
    a.channelId === b.channelId &&
    (a.threadRootId ?? undefined) === (b.threadRootId ?? undefined)
  );
}

function loadCommunityDestinations(storage: Storage): CommunityDestinations {
  try {
    const raw = storage.getItem(COMMUNITY_DESTINATIONS_KEY);
    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, CommunityDestination] =>
          isCommunityDestination(entry[1]),
        )
        .map(([id, destination]) => [
          id,
          normalizeCommunityDestination(destination),
        ]),
    );
  } catch {
    return {};
  }
}

function saveCommunityDestinations(
  destinations: CommunityDestinations,
  storage: Storage,
): void {
  const serialized = JSON.stringify(destinations);
  if (typeof window !== "undefined" && storage === window.localStorage) {
    setLocalStorageItemWithRecovery(COMMUNITY_DESTINATIONS_KEY, serialized);
    return;
  }
  storage.setItem(COMMUNITY_DESTINATIONS_KEY, serialized);
}

export function loadCommunityDestination(
  communityId: string,
  storage: Storage = localStorage,
): CommunityDestination | null {
  return loadCommunityDestinations(storage)[communityId] ?? null;
}

export function saveCommunityDestination(
  communityId: string,
  destination: CommunityDestination,
  storage: Storage = localStorage,
): void {
  const next = normalizeCommunityDestination(destination);
  const current = loadCommunityDestination(communityId, storage);
  if (destinationsEqual(current, next)) {
    return;
  }
  saveCommunityDestinations(
    { ...loadCommunityDestinations(storage), [communityId]: next },
    storage,
  );
}

export function removeCommunityDestination(
  communityId: string,
  storage: Storage = localStorage,
): void {
  if (pendingCommunityRestoreId === communityId) {
    pendingCommunityRestoreId = null;
  }
  const destinations = loadCommunityDestinations(storage);
  if (!(communityId in destinations)) {
    return;
  }
  delete destinations[communityId];
  saveCommunityDestinations(destinations, storage);
}

export function clearCommunityDestinations(
  storage: Storage = localStorage,
): void {
  storage.removeItem(COMMUNITY_DESTINATIONS_KEY);
  pendingCommunityRestoreId = null;
}

export function markPendingCommunityRestore(communityId: string): void {
  pendingCommunityRestoreId = communityId;
}

export function consumePendingCommunityRestore(communityId: string): boolean {
  if (pendingCommunityRestoreId !== communityId) {
    return false;
  }
  pendingCommunityRestoreId = null;
  return true;
}

/**
 * Build a destination snapshot from the current shell route + channel search.
 * Only home and channel views are remembered; other routes leave prior state.
 */
export function communityDestinationFromRoute(options: {
  selectedView: string;
  selectedChannelId: string | null;
  threadRootId?: string | null;
}): CommunityDestination | null {
  if (options.selectedView === "home") {
    return { kind: "home" };
  }
  if (options.selectedView === "channel" && options.selectedChannelId) {
    const threadRootId =
      typeof options.threadRootId === "string" &&
      options.threadRootId.length > 0
        ? options.threadRootId
        : undefined;
    return threadRootId
      ? {
          kind: "channel",
          channelId: options.selectedChannelId,
          threadRootId,
        }
      : { kind: "channel", channelId: options.selectedChannelId };
  }
  return null;
}

export function threadRootIdFromLocationSearch(
  search: unknown,
): string | undefined {
  if (!search || typeof search !== "object") {
    return undefined;
  }
  const record = search as Record<string, unknown>;
  const thread =
    typeof record.thread === "string" && record.thread.length > 0
      ? record.thread
      : undefined;
  const threadRootId =
    typeof record.threadRootId === "string" && record.threadRootId.length > 0
      ? record.threadRootId
      : undefined;
  // Panel open state uses `thread`; deep-links may use `threadRootId`.
  return thread ?? threadRootId;
}
