import { getEnvironment, getThread } from "@bb/db";
import {
  isPluginPendingInteraction,
  type PendingInteraction,
} from "@bb/domain";
import type { CommandResultSideEffectsDeps } from "../../internal/command-result-side-effects.js";
import { requestThreadStop } from "./thread-lifecycle.js";

export function haltThreadForUnansweredQuestion(
  deps: CommandResultSideEffectsDeps,
  interaction: PendingInteraction,
): void {
  if (!isPluginPendingInteraction(interaction)) {
    return;
  }
  if (interaction.origin.pluginId !== "ask-user-question") {
    return;
  }
  if (interaction.origin.rendererId !== "ask-user-question") {
    return;
  }
  if (
    interaction.status !== "interrupted" ||
    interaction.statusReason !== "timeout"
  ) {
    return;
  }
  queueMicrotask(() => {
    try {
      const thread = getThread(deps.db, interaction.threadId);
      if (
        !thread ||
        thread.status !== "active" ||
        thread.environmentId === null
      ) {
        return;
      }
      const environment = getEnvironment(deps.db, thread.environmentId);
      if (!environment) {
        return;
      }
      requestThreadStop(deps, {
        environmentId: environment.id,
        hostId: environment.hostId,
        interruptionReason: "question-unanswered",
        threadId: thread.id,
      });
      deps.logger.info(
        { threadId: thread.id, interactionId: interaction.id },
        "Halted turn: AskUserQuestion timed out with no answer",
      );
    } catch (error) {
      deps.logger.warn(
        { err: error, threadId: interaction.threadId },
        "Failed to halt turn after an unanswered question",
      );
    }
  });
}
