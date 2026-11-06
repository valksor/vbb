import type {
  ResolveThreadBranchPromotionRequest,
  ThreadBranchPromotionResponse,
} from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";
import type {
  ThreadActionArgs,
  ThreadBackgroundTaskOutputArgs,
  ThreadBackgroundTaskOutputResult,
  ThreadExecutionProfileResult,
  ThreadStatusArgs,
} from "./threads.js";

export interface ForkThreadsArea {
  experimental_executionProfile(
    args: ThreadStatusArgs,
  ): Promise<ThreadExecutionProfileResult>;
  experimental_backgroundTaskOutput(
    args: ThreadBackgroundTaskOutputArgs,
  ): Promise<ThreadBackgroundTaskOutputResult>;
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
    async experimental_executionProfile(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"]["execution-profile"].$get(
          { param: { id: input.threadId } },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async experimental_backgroundTaskOutput(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"]["background-tasks"][
          ":itemId"
        ].output.$get(
          {
            param: { id: input.threadId, itemId: input.itemId },
            query:
              input.tailBytes === undefined
                ? {}
                : { tailBytes: String(input.tailBytes) },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
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
