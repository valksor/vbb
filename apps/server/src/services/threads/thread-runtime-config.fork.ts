import type { DynamicTool, Thread } from "@bb/domain";
import { DEFAULT_ENVIRONMENT_PROVIDER_ID } from "../environments/environment-provider-ids.js";
import {
  ENTER_BRANCH_INSTRUCTIONS,
  ENTER_BRANCH_TOOL,
} from "./thread-environment-branch.fork.js";
import {
  ENTER_WORKTREE_TOOL,
  KEEP_CHECKOUT_TOOL,
} from "./thread-environment-directory.fork.js";

const ENTER_WORKTREE_INSTRUCTIONS =
  "When the user asks you to implement, modify, fix, refactor, or otherwise change project files, keep read-only exploration in the current checkout so repository-local indexes such as Ripwire remain available. Unless the user explicitly asks to keep changes in the current checkout or avoid a worktree, call `bb_enter_worktree` when you are ready to make the first change, before the first edit or any command that may modify the project. Do this automatically without asking the user to create or enter a worktree. After the tool succeeds, stop the current turn; bb queues the next turn automatically in the prepared worktree. If the tool reports that the checkout cannot be promoted safely, follow its guidance without retrying — in particular, do not reach for a different worktree mechanism to get around the refusal.";
const KEEP_CHECKOUT_INSTRUCTIONS =
  "If the user asks to work in the current checkout, to skip the worktree, or declines a worktree when you offer one, call `bb_keep_checkout` before continuing. That records the decision for the whole thread, so these instructions stop asking you to promote on later turns. Do not call it on your own initiative; the user's instruction is what makes it true.";

interface PromotionToolContribution {
  tool: DynamicTool;
  instructions: string;
  pluginId: null;
}

export function resolvePromotionToolContributions(
  thread: Pick<Thread, "promotionTarget" | "worktreePromotion">,
  project: { kind: string },
  environment: {
    environmentProviderId: string | null;
    isGitRepo: boolean;
    isWorktree: boolean;
  },
): PromotionToolContribution[] {
  const includeEnterWorktree =
    thread.worktreePromotion === "armed" &&
    project.kind === "standard" &&
    environment.isGitRepo &&
    environment.environmentProviderId !==
      DEFAULT_ENVIRONMENT_PROVIDER_ID.gitWorktree &&
    !environment.isWorktree;
  if (!includeEnterWorktree) return [];
  return [
    {
      tool:
        thread.promotionTarget === "branch"
          ? ENTER_BRANCH_TOOL
          : ENTER_WORKTREE_TOOL,
      instructions:
        thread.promotionTarget === "branch"
          ? ENTER_BRANCH_INSTRUCTIONS
          : ENTER_WORKTREE_INSTRUCTIONS,
      pluginId: null,
    },
    {
      tool: KEEP_CHECKOUT_TOOL,
      instructions:
        thread.promotionTarget === "branch"
          ? "Call bb_keep_checkout only when the user explicitly asks to keep the current branch or skip branching. Staying in the checkout alone does not decline branching."
          : KEEP_CHECKOUT_INSTRUCTIONS,
      pluginId: null,
    },
  ];
}
