import { useCallback, useMemo } from "react";
import type { PermissionMode, ReasoningLevel, ServiceTier } from "@bb/domain";
import {
  buildThreadHandoffFollowUpDraftWithOwnAttachments,
  THREAD_HANDOFF_COMPOSE_SEED_LOCATION_STATE_KEY,
  type ThreadHandoffComposeSeed,
  type ThreadHandoffCreateSeed,
} from "@bb/client-core";
import type { useImmediateRouteNavigate } from "@/components/ui/app-route-anchor";
import type { PromptDraftController } from "@/hooks/usePromptDraftStorage";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";

interface UseHandoffComposerNavigationArgs {
  effectiveSelectedModel: string;
  exitHandoff: () => void;
  handoffSeed: ThreadHandoffCreateSeed;
  isHandoffSelection: boolean;
  navigate: ReturnType<typeof useImmediateRouteNavigate>;
  permissionMode: PermissionMode;
  promptDraft: PromptDraftController;
  reasoningLevel: ReasoningLevel;
  selectedProviderId: string;
  serviceTier: ServiceTier | undefined;
  sourceThreadDisplayTitle: string;
  supportsServiceTier: boolean;
  thread: { environmentId: string | null; id: string; projectId: string };
}

export function useHandoffComposerNavigation({
  effectiveSelectedModel,
  exitHandoff,
  handoffSeed,
  isHandoffSelection,
  navigate,
  permissionMode,
  promptDraft,
  reasoningLevel,
  selectedProviderId,
  serviceTier,
  sourceThreadDisplayTitle,
  supportsServiceTier,
  thread,
}: UseHandoffComposerNavigationArgs) {
  const setRootComposeProjectId = useSetRootComposeProjectId();
  const openHandoffComposer = useCallback(
    (environmentId: string | null) => {
      if (effectiveSelectedModel.length === 0) return;
      const composeSeed: ThreadHandoffComposeSeed = {
        draft: buildThreadHandoffFollowUpDraftWithOwnAttachments(handoffSeed, promptDraft.getCurrent()),
        environmentId,
        model: effectiveSelectedModel,
        permissionMode,
        projectId: thread.projectId,
        providerId: selectedProviderId,
        reasoningLevel,
        serviceTier: supportsServiceTier ? serviceTier : undefined,
        sourceThreadId: thread.id,
        sourceThreadTitle: sourceThreadDisplayTitle,
      };
      promptDraft.clear();
      exitHandoff();
      setRootComposeProjectId(thread.projectId);
      navigate(getRootComposeRoutePath(), {
        state: { focusPrompt: true, [THREAD_HANDOFF_COMPOSE_SEED_LOCATION_STATE_KEY]: composeSeed },
      });
    },
    [effectiveSelectedModel, exitHandoff, handoffSeed, navigate, permissionMode, promptDraft, reasoningLevel, selectedProviderId, serviceTier, setRootComposeProjectId, sourceThreadDisplayTitle, supportsServiceTier, thread.id, thread.projectId],
  );
  const moveHandoffToNewThreadComposer = useCallback(() => {
    if (!isHandoffSelection) return;
    openHandoffComposer(thread.environmentId);
  }, [isHandoffSelection, openHandoffComposer, thread.environmentId]);
  const handleContinueInNewThread = useMemo(
    () => effectiveSelectedModel.length === 0 ? null : () => openHandoffComposer(null),
    [effectiveSelectedModel, openHandoffComposer],
  );
  return { handleContinueInNewThread, moveHandoffToNewThreadComposer };
}
