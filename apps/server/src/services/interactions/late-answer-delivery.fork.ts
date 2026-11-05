import { getThread } from "@bb/db";
import type { CreateQueuedMessageRequest } from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import { createQueuedMessageForThread } from "../threads/queued-messages.js";
import type { AppDeps } from "../../types.js";

export function installLateAnswerRecovery(deps: AppDeps): void {
  deps.pendingInteractions.setUnclaimedPluginAnswerDeliverer(
    async ({ delivery, claimInTransaction }) => {
      const thread = getThread(deps.db, delivery.threadId);
      if (!thread) {
        throw new ApiError(404, "thread_not_found", "Thread not found");
      }
      const payload: CreateQueuedMessageRequest = {
        input: [{ type: "text", text: delivery.text, mentions: [] }],
      };
      await createQueuedMessageForThread(deps, {
        payload,
        thread,
        withinTransaction: claimInTransaction,
      });
    },
  );
}
