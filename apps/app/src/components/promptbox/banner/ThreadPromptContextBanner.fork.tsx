import type { ReactNode } from "react";
import type { ThreadPendingInteractionKind } from "@bb/domain";
import { Icon } from "@bb/shared-ui/icon";
import { PromptBannerActionButton } from "@bb/shared-ui/prompt-banner-actions";
import {
  sharedPendingInteractionKind,
  threadIndicatorLabel,
  waitingIndicatorForPendingInteraction,
} from "@get-bb/plugin-sdk/internal/thread-status";
import { WAITING_ICONS } from "@/components/thread/ThreadStatusGlyph";
import type { ThreadPromptEnvironmentGoneSection } from "./ThreadPromptContextBanner";

export function WaitingKindIcon({
  className,
  kind,
}: {
  className: string;
  kind: ThreadPendingInteractionKind | null;
}) {
  const indicator = waitingIndicatorForPendingInteraction(kind);
  return (
    <Icon
      name={WAITING_ICONS[indicator]}
      className={className}
      aria-label={threadIndicatorLabel(indicator) ?? undefined}
    />
  );
}

export function sharedWaitingKind(
  items: readonly {
    hasPendingInteraction: boolean;
    pendingInteractionKind: ThreadPendingInteractionKind | null;
  }[],
): ThreadPendingInteractionKind | null {
  return sharedPendingInteractionKind(
    items
      .filter((item) => item.hasPendingInteraction)
      .map((item) => item.pendingInteractionKind),
  );
}

export function continueInNewThreadAction(
  section: ThreadPromptEnvironmentGoneSection | null,
): ReactNode {
  if (!section?.onContinueInNewThread) return null;
  return (
    <PromptBannerActionButton
      key="continue"
      onClick={section.onContinueInNewThread}
    >
      Continue in new thread
    </PromptBannerActionButton>
  );
}
