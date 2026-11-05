import type { ReactNode } from "react";
import { PromptBannerActionButton } from "@bb/shared-ui/prompt-banner-actions";
import type { ThreadPromptEnvironmentGoneSection } from "./ThreadPromptContextBanner";

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
