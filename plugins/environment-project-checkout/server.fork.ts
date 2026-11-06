import type {
  BranchPromotionRequest,
  BranchPromotionSnapshot,
} from "bb-checkout-contract/branch-promotion";
import type {
  PluginEnvironmentProviderCreateContext,
  PluginEnvironmentProviderCreateResult,
  PluginEnvironmentProviderProgress,
} from "@get-bb/plugin-sdk/environment-provider";
import type { checkoutInputsSchema } from "./server.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function refusePromotionInput(inputs: {
  promotion?: BranchPromotionRequest | undefined;
}): { action: "refuse"; message: string } | null {
  if (inputs.promotion === undefined) return null;
  return {
    action: "refuse",
    message: "Branch promotion is reserved for the internal promotion workflow",
  };
}

export async function createPromotion(args: {
  context: PluginEnvironmentProviderCreateContext<
    { projectCheckout: true },
    typeof checkoutInputsSchema
  >;
  promotion: BranchPromotionRequest;
  reports: Map<string, PluginEnvironmentProviderProgress>;
  host: {
    call(
      method: "promoteBranch",
      request: BranchPromotionRequest,
      options: { hostId: string; signal: AbortSignal; timeoutMs: number },
    ): Promise<BranchPromotionSnapshot>;
  };
  otherLiveThreadUsesPath(args: {
    hostId: string;
    path: string;
    threadId: string | null;
  }): Promise<boolean>;
  liveThreadMessage: string;
  timeoutMs: number;
}): Promise<PluginEnvironmentProviderCreateResult> {
  const { context, promotion, reports } = args;
  const hostId = context.host.id;
  if (
    context.inputs.path !== undefined ||
    context.inputs.branch !== undefined
  ) {
    return {
      status: "failed",
      message: "Promotion cannot be combined with checkout inputs",
    };
  }
  if (!(await context.experimental_claimPath(promotion.intent.path))) {
    return {
      status: "failed",
      message: "Branch promotion reservation is no longer held",
    };
  }
  const blocked =
    promotion.action === "enter" &&
    (await args.otherLiveThreadUsesPath({
      hostId,
      path: promotion.intent.path,
      threadId: context.thread.id,
    }));
  const operationId = promotion.intent.operationId;
  reports.set(operationId, context.report);
  try {
    const result = await args.host.call(
      "promoteBranch",
      blocked ? { action: "inspect", intent: promotion.intent } : promotion,
      { hostId, signal: context.signal, timeoutMs: args.timeoutMs },
    );
    return {
      status: "created",
      path: promotion.intent.path,
      ownsPath: false,
      resource: blocked
        ? { ...result, message: args.liveThreadMessage }
        : result,
    };
  } catch (error) {
    if (context.signal.aborted) throw error;
    return { status: "failed", message: errorMessage(error) };
  } finally {
    reports.delete(operationId);
  }
}
