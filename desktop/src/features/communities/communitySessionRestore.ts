/**
 * Pure helpers for restoring last shell location after cold start or
 * community switch. AppShell owns side effects (navigation, getEventById).
 */

import type { CommunityDestination } from "./communityNavigationStorage";

/** Shell path prefixes we will restore; anything else is ignored. */
const RESTORABLE_PATH_PREFIXES = [
  "/agents",
  "/workflows",
  "/projects",
  "/pulse",
  "/messages/new",
  "/settings",
] as const;

export type RestorePlan =
  | { action: "none" }
  /** Clear saved dest and ensure Home (stale channel). */
  | { action: "home"; clearSaved: boolean }
  | {
      action: "channel";
      channelId: string;
      /** May still need async probe before navigation. */
      threadRootId?: string;
    }
  | { action: "location"; pathname: string; search?: string };

export function isRestorableShellPath(pathname: string): boolean {
  if (pathname === "/" || pathname === "") {
    return true;
  }
  // Forum post deep path under a channel.
  if (/^\/channels\/[^/]+\/posts\/[^/]+/.test(pathname)) {
    return true;
  }
  return RESTORABLE_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function channelIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/channels\/([^/]+)/);
  if (!match?.[1]) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * Decide what restore should do given current route + remembered destination.
 * Does not perform I/O (thread existence is handled by the caller).
 */
export function planCommunitySessionRestore(options: {
  pendingRestore: boolean;
  /** Current shell view from deriveShellRoute (settings reports as home). */
  selectedView: string;
  pathname: string;
  destination: CommunityDestination | null;
  /** True when the remembered channel is still openable for this user. */
  channelAvailable: boolean;
}): RestorePlan {
  const { pendingRestore, selectedView, pathname, destination } = options;

  // Default cold-boot hash is Home at `/`.
  const isDefaultHome =
    (pathname === "/" || pathname === "") && selectedView === "home";

  // Deep links / explicit non-home routes always win on cold start.
  // Community-switch pre-writes the target hash before the community mounts,
  // so we also skip when already on a concrete route and not pending.
  if (!pendingRestore && !isDefaultHome) {
    return { action: "none" };
  }

  if (!destination || destination.kind === "home") {
    return { action: "none" };
  }

  if (destination.kind === "channel") {
    if (!options.channelAvailable) {
      return { action: "home", clearSaved: true };
    }

    const currentChannelId = channelIdFromPathname(pathname);
    // Optimistic community-switch write already put us on the right channel.
    if (currentChannelId === destination.channelId && !isDefaultHome) {
      return { action: "none" };
    }

    return {
      action: "channel",
      channelId: destination.channelId,
      threadRootId: destination.threadRootId,
    };
  }

  // destination.kind === "location"
  if (!isRestorableShellPath(destination.pathname)) {
    return { action: "home", clearSaved: true };
  }

  if (pathname === destination.pathname && !isDefaultHome) {
    return { action: "none" };
  }

  return {
    action: "location",
    pathname: destination.pathname,
    search: destination.search,
  };
}

/**
 * Whether a channel id is openable: known member row and not archived.
 * Sidebar visibility is preferred by the UI but not required here (e.g. a
 * temporary huddle filter should not drop restore of a real membership).
 */
export function isChannelRestorable(
  channelId: string,
  channels: ReadonlyArray<{
    id: string;
    archivedAt: string | null;
  }>,
): boolean {
  return channels.some(
    (channel) => channel.id === channelId && channel.archivedAt === null,
  );
}

/**
 * Parse location.search (object or string) into a stable query string without `?`.
 */
export function serializeSearchForDestination(
  search: unknown,
): string | undefined {
  if (search == null) {
    return undefined;
  }
  if (typeof search === "string") {
    const trimmed = search.startsWith("?") ? search.slice(1) : search;
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof search !== "object") {
    return undefined;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(
    search as Record<string, unknown>,
  )) {
    if (typeof value === "string" && value.length > 0) {
      params.set(key, value);
    } else if (typeof value === "number" || typeof value === "boolean") {
      params.set(key, String(value));
    }
  }
  const serialized = params.toString();
  return serialized.length > 0 ? serialized : undefined;
}

/**
 * Build a history href for a location destination.
 */
export function locationDestinationHref(
  pathname: string,
  search?: string,
): string {
  if (!search) {
    return pathname;
  }
  const q = search.startsWith("?") ? search.slice(1) : search;
  return q.length > 0 ? `${pathname}?${q}` : pathname;
}
