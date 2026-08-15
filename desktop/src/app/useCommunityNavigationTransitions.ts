import { useRouter } from "@tanstack/react-router";
import * as React from "react";

import type { deriveShellRoute } from "@/app/AppShell.helpers";
import type { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  replaceCommunityDestinationRoute,
  runCommunityViewTransition,
} from "@/app/communityViewTransition";
import {
  communityDestinationFromRoute,
  loadCommunityDestination,
  markPendingCommunityRestore,
  saveCommunityDestination,
  threadRootIdFromLocationSearch,
  type CommunityDestination,
} from "@/features/communities/communityNavigationStorage";
import { locationDestinationHref } from "@/features/communities/communitySessionRestore";
import { markCommunityDiscoveryAfterLeave } from "@/features/communities/communityStorage";
import type { useCommunities } from "@/features/communities/useCommunities";
import { leaveCommunity } from "@/features/communities/leaveCommunity";

type Communities = ReturnType<typeof useCommunities>;
type ShellRoute = ReturnType<typeof deriveShellRoute>;
type GoHome = ReturnType<typeof useAppNavigation>["goHome"];

function writeDestinationToHistory(
  destination: CommunityDestination,
  history: { replace: (href: string) => void },
): void {
  if (destination.kind === "channel") {
    replaceCommunityDestinationRoute(destination.channelId, history, {
      threadRootId: destination.threadRootId,
    });
    return;
  }
  if (destination.kind === "location") {
    history.replace(
      locationDestinationHref(destination.pathname, destination.search),
    );
    return;
  }
  history.replace("/");
}

export function useCommunityNavigationTransitions({
  communities,
  goHome,
  selectedChannelId,
  selectedView,
  locationSearch,
  pathname,
}: {
  communities: Communities;
  goHome: GoHome;
  selectedChannelId: ShellRoute["selectedChannelId"];
  selectedView: ShellRoute["selectedView"];
  locationSearch?: unknown;
  pathname?: string;
}) {
  const router = useRouter();
  const saveActiveDestination = React.useCallback(() => {
    const activeCommunityId = communities.activeCommunity?.id;
    if (!activeCommunityId) return;
    const destination = communityDestinationFromRoute({
      pathname: pathname ?? router.state.location.pathname,
      selectedView,
      selectedChannelId,
      threadRootId: threadRootIdFromLocationSearch(
        locationSearch ?? router.state.location.search,
      ),
      search: locationSearch ?? router.state.location.search,
    });
    if (destination) {
      saveCommunityDestination(activeCommunityId, destination);
    }
  }, [
    communities.activeCommunity?.id,
    locationSearch,
    pathname,
    router.state.location.pathname,
    router.state.location.search,
    selectedChannelId,
    selectedView,
  ]);

  // Home is a teardown barrier: the outgoing channel must unmount before the
  // relay changes, or its read effect can advance markers on the wrong relay.
  const switchCommunity = React.useCallback(
    async (id: string) => {
      const activeCommunityId = communities.activeCommunity?.id;
      if (id === activeCommunityId) return;
      if (!activeCommunityId) {
        communities.switchCommunity(id);
        return;
      }

      await runCommunityViewTransition(async () => {
        saveActiveDestination();
        await goHome({ replace: true });
        markPendingCommunityRestore(id);
        const destination = loadCommunityDestination(id);
        if (destination) {
          writeDestinationToHistory(destination, router.history);
        }
        communities.switchCommunity(id);
      });
    },
    [communities, goHome, router.history, saveActiveDestination],
  );

  const removeCommunity = React.useCallback(
    async (id: string) => {
      const target = communities.communities.find(
        (community) => community.id === id,
      );
      if (!target) return;

      const fallback = communities.communities.find(
        (community) => community.id !== id,
      );

      // Do not touch local state until this relay has explicitly accepted the
      // signed NIP-43 leave request. Rejections and timeouts bubble back to the
      // dialog so the person can retry without losing their community config.
      const leaveResult = await leaveCommunity(
        target.relayUrl,
        communities.activeCommunity?.relayUrl,
      );

      if (id !== communities.activeCommunity?.id) {
        communities.removeCommunity(id);
        return leaveResult;
      }

      if (!fallback) {
        if (!markCommunityDiscoveryAfterLeave()) {
          throw new Error(
            "Membership was removed, but community discovery state could not be saved. Restart Buzz and try again.",
          );
        }
        await goHome({ replace: true });
        communities.removeCommunity(id);
        return leaveResult;
      }

      await runCommunityViewTransition(async () => {
        saveActiveDestination();
        await goHome({ replace: true });
        markPendingCommunityRestore(fallback.id);
        const destination = loadCommunityDestination(fallback.id);
        if (destination) {
          writeDestinationToHistory(destination, router.history);
        }
        communities.removeCommunity(id);
      });
      return leaveResult;
    },
    [communities, goHome, router.history, saveActiveDestination],
  );

  return { removeCommunity, switchCommunity };
}
