import { useCallback, useMemo, type ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import {
  mergeThreadHandoffComposeDraft,
  readThreadHandoffComposeSeedFromLocationState,
  type PromptDraftState,
  type ThreadHandoffComposeSeed,
} from "@bb/client-core";
import { encodeReuseValue } from "@/components/pickers/environment-picker-value";
import type {
  NewThreadComposerSeed,
  NewThreadComposerState,
} from "@/components/promptbox/NewThreadComposer";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";

export function buildHandoffComposerSeed(
  handoffSeed: ThreadHandoffComposeSeed,
  projectId: string,
): NewThreadComposerSeed {
  return {
    providerId: handoffSeed.providerId,
    model: handoffSeed.model,
    reasoningLevel: handoffSeed.reasoningLevel,
    serviceTier: handoffSeed.serviceTier,
    permissionMode: handoffSeed.permissionMode,
    ...(handoffSeed.environmentId !== null &&
    projectId === handoffSeed.projectId
      ? {
          environment: {
            type: "reuse" as const,
            environmentId: handoffSeed.environmentId,
          },
        }
      : {}),
  };
}

export function useHandoffComposerProps(
  handoffSeed: ThreadHandoffComposeSeed | null,
  rootComposeProjectId: string,
) {
  const composerSeed = useMemo(
    () =>
      handoffSeed === null
        ? undefined
        : buildHandoffComposerSeed(handoffSeed, rootComposeProjectId),
    [handoffSeed, rootComposeProjectId],
  );
  const carryHandoffDraftToProject = useMemo(
    () =>
      handoffSeed === null
        ? undefined
        : (draft: PromptDraftState, targetDraft: PromptDraftState) =>
            mergeThreadHandoffComposeDraft(handoffSeed, draft, targetDraft),
    [handoffSeed],
  );
  return { carryHandoffDraftToProject, composerSeed };
}

interface HandoffSeedApplierArgs {
  composer: NewThreadComposerState;
  setHandoffSeed: (seed: ThreadHandoffComposeSeed | null) => void;
  setRootComposeProjectId: (projectId: string) => void;
}

export function useHandoffSeedApplier({
  composer,
  setHandoffSeed,
  setRootComposeProjectId,
}: HandoffSeedApplierArgs) {
  const {
    seedEnvironmentSelectionValue,
    setPermissionMode,
    setProviderModelReasoning,
    setServiceTier,
  } = composer;
  return useCallback(
    (state: unknown) => {
      const nextHandoffSeed =
        readThreadHandoffComposeSeedFromLocationState(state);
      if (nextHandoffSeed === null) return;
      setHandoffSeed(nextHandoffSeed);
      setRootComposeProjectId(nextHandoffSeed.projectId);
      setProviderModelReasoning(nextHandoffSeed);
      setPermissionMode(nextHandoffSeed.permissionMode);
      setServiceTier(nextHandoffSeed.serviceTier);
      if (nextHandoffSeed.environmentId !== null) {
        seedEnvironmentSelectionValue(
          encodeReuseValue(nextHandoffSeed.environmentId),
        );
      }
      const handoffTargetDraft = getPromptDraftAccessor({
        kind: "new-thread",
        projectId: nextHandoffSeed.projectId,
      });
      handoffTargetDraft.setDraft(
        mergeThreadHandoffComposeDraft(
          nextHandoffSeed,
          nextHandoffSeed.draft,
          handoffTargetDraft.getCurrent(),
        ),
      );
    },
    [
      seedEnvironmentSelectionValue,
      setHandoffSeed,
      setPermissionMode,
      setProviderModelReasoning,
      setRootComposeProjectId,
      setServiceTier,
    ],
  );
}

interface HandoffPromptHeaderArgs {
  focusPromptBox: () => void;
  handoffSeed: ThreadHandoffComposeSeed | null;
  setHandoffSeed: (seed: ThreadHandoffComposeSeed | null) => void;
}

export function useHandoffPromptHeader({
  focusPromptBox,
  handoffSeed,
  setHandoffSeed,
}: HandoffPromptHeaderArgs): ReactNode {
  const handleCancelHandoffDraft = useCallback(() => {
    setHandoffSeed(null);
    window.requestAnimationFrame(focusPromptBox);
  }, [focusPromptBox, setHandoffSeed]);

  return useMemo(() => {
    if (handoffSeed === null) return null;
    return (
      <div className="flex">
        <div
          aria-label={`Handing off ${handoffSeed.sourceThreadTitle}`}
          className="-ml-1.5 inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-muted py-0 pl-2.5 pr-1 text-xs font-medium text-muted-foreground"
        >
          <Icon name="MessageSquarePlus" className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">Handing off {handoffSeed.sourceThreadTitle}</span>
          <button
            type="button"
            aria-label="Cancel handoff"
            className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={handleCancelHandoffDraft}
          >
            <Icon name="X" className="size-3" aria-hidden />
          </button>
        </div>
      </div>
    );
  }, [handleCancelHandoffDraft, handoffSeed]);
}
