import { PERSONAL_PROJECT_ID, type ThreadWorktreePromotion } from "@bb/domain";
import { ApiError } from "../../errors.js";
import { DEFAULT_ENVIRONMENT_PROVIDER_ID } from "../environments/environment-provider-ids.js";
import type {
  CreateThreadEnvironment,
  ResolvedCreateThreadEnvironment,
} from "./thread-default-policy.js";

export function assertBranchPromotionAllowed(args: {
  projectId: string;
  requestedEnvironment: CreateThreadEnvironment;
}): void {
  if (
    args.requestedEnvironment.type === "project-default" &&
    args.requestedEnvironment.promotion === "branch" &&
    args.projectId === PERSONAL_PROJECT_ID
  )
    throw new ApiError(
      422,
      "branch_promotion_requires_project_checkout",
      "Branch promotion requires a standard project checkout.",
    );
}

export function resolveCreateThreadWorktreePromotion(args: {
  requestedEnvironment: CreateThreadEnvironment;
  resolvedEnvironment: ResolvedCreateThreadEnvironment;
}): ThreadWorktreePromotion {
  if (args.requestedEnvironment.type !== "project-default") return "declined";
  if (
    args.requestedEnvironment.promotion === "branch" &&
    !(
      args.resolvedEnvironment.type === "provider" &&
      args.resolvedEnvironment.environmentProviderId ===
        DEFAULT_ENVIRONMENT_PROVIDER_ID.projectCheckout
    )
  )
    throw new Error(
      "Checkout, then branch requires an available project checkout; choose another environment.",
    );
  return args.resolvedEnvironment.type === "provider" &&
    args.resolvedEnvironment.environmentProviderId ===
      DEFAULT_ENVIRONMENT_PROVIDER_ID.projectCheckout
    ? "armed"
    : "declined";
}
