import type {
  ResolveThreadBranchPromotionRequest,
  ThreadBranchPromotionResponse,
} from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";
import type { ThreadActionArgs } from "./threads.js";

export interface ForkThreadsArea {
  inspectBranchPromotion(
    args: ThreadActionArgs,
  ): Promise<ThreadBranchPromotionResponse>;
  resolveBranchPromotion(
    args: ThreadActionArgs & ResolveThreadBranchPromotionRequest,
  ): Promise<ThreadBranchPromotionResponse>;
}

export function createForkThreadsMethods(
  args: CreateSdkAreaArgs,
): ForkThreadsArea {
  const { transport } = args;
  return {
    inspectBranchPromotion: (input) =>
      transport.readJson(
        transport.api.v1.threads[":id"]["branch-promotion"].$get(
          { param: { id: input.threadId } },
          ...signalRequestArgs(input.signal),
        ),
      ),
    resolveBranchPromotion: (input) =>
      transport.readJson(
        transport.api.v1.threads[":id"]["branch-promotion"].resolve.$post(
          {
            param: { id: input.threadId },
            json: {
              operationId: input.operationId,
              observation: input.observation,
              resolution: input.resolution,
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      ),
  };
}
