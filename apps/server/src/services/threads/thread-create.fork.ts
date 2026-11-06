import type { ThreadWorktreePromotion } from "@bb/domain";
import type {
  CreateThreadEnvironment,
  ResolvedCreateThreadEnvironment,
} from "./thread-default-policy.js";
import { resolveCreateThreadWorktreePromotion } from "./thread-default-policy.fork.js";

export function forkCreateRequestFields(
  requestInput: { environment: CreateThreadEnvironment },
  requestedEnvironment: ResolvedCreateThreadEnvironment,
): {
  promotionTarget: "worktree" | "branch";
  worktreePromotion: ThreadWorktreePromotion;
} {
  return {
    promotionTarget:
      requestInput.environment.type === "project-default"
        ? (requestInput.environment.promotion ?? "worktree")
        : "worktree",
    worktreePromotion: resolveCreateThreadWorktreePromotion({
      requestedEnvironment: requestInput.environment,
      resolvedEnvironment: requestedEnvironment,
    }),
  };
}
