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
} from "@/features/communities/communityNavigationStorage";
import type { useCommunities } from "@/features/communities/useCommunities";

type Communities = ReturnType<typeof useCommunities>;
type ShellRoute = ReturnType<typeof deriveShellRoute>;
type GoHome = ReturnType<typeof useAppNavigation>["goHome"];

export function useCommunityNavigationTransitions({
  communities,
  goHome,
  selectedChannelId,
  selectedView,
  locationSearch,
}: {
  communities: Communities;
  goHome: GoHome;
  selectedChannelId: ShellRoute["selectedChannelId"];
  selectedView: ShellRoute["selectedView"];
  locationSearch?: unknown;
}) {
  const router = useRouter();
  const saveActiveDestination = React.useCallback(() => {
    const activeCommunityId = communities.activeCommunity?.id;
    if (!activeCommunityId) return;
    const destination = communityDestinationFromRoute({
      selectedView,
      selectedChannelId,
      threadRootId: threadRootIdFromLocationSearch(
        locationSearch ?? router.state.location.search,
      ),
    });
    if (destination) {
      saveCommunityDestination(activeCommunityId, destination);
    }
  }, [
    communities.activeCommunity?.id,
    locationSearch,
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
        if (destination?.kind === "channel") {
          replaceCommunityDestinationRoute(
            destination.channelId,
            router.history,
            { threadRootId: destination.threadRootId },
          );
        }
        communities.switchCommunity(id);
      });
    },
    [communities, goHome, router.history, saveActiveDestination],
  );

  const removeCommunity = React.useCallback(
    async (id: string) => {
      if (id !== communities.activeCommunity?.id) {
        communities.removeCommunity(id);
        return;
      }
      const fallback = communities.communities.find(
        (community) => community.id !== id,
      );
      if (!fallback) return;

      await runCommunityViewTransition(async () => {
        saveActiveDestination();
        await goHome({ replace: true });
        markPendingCommunityRestore(fallback.id);
        const destination = loadCommunityDestination(fallback.id);
        if (destination?.kind === "channel") {
          replaceCommunityDestinationRoute(
            destination.channelId,
            router.history,
            { threadRootId: destination.threadRootId },
          );
        }
        communities.removeCommunity(id);
      });
    },
    [communities, goHome, router.history, saveActiveDestination],
  );

  return { removeCommunity, switchCommunity };
}
