import type { ExperimentalHostRpcHandlers } from "@get-bb/plugin-sdk/host";
import { createHostProgress } from "bb-environment-provider-host/progress";
import type { checkoutHostContract, checkoutHostSignals } from "./contract.js";
import { promoteBranch } from "./host/branch-promotion.js";

export function branchPromotionHostMethods(): Pick<
  ExperimentalHostRpcHandlers<
    typeof checkoutHostContract,
    typeof checkoutHostSignals
  >,
  "promoteBranch"
> {
  return {
    async promoteBranch(input, context) {
      return promoteBranch({
        request: input,
        dataDir: context.experimental_paths.dataDir,
        signal: context.signal,
        onProgress: createHostProgress({
          operationId: input.intent.operationId,
          emit: (payload) =>
            context.experimental_emitSignal("progress", payload),
        }),
      });
    },
  };
}
