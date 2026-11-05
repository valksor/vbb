import {
  getPendingInteraction,
  setTimedOutPendingInteractionResolved,
  type DbTransaction,
} from "@bb/db";
import {
  isPluginPendingInteraction,
  isPluginPendingInteractionResolution,
  type JsonValue,
  type PendingInteraction,
  type PendingInteractionResolution,
  type PluginPendingInteraction,
} from "@bb/domain";
import { ApiError } from "../../errors.js";
import type { ServerLogger } from "../../types.js";
import {
  planUnclaimedAnswerDelivery,
  type UnclaimedAnswerDelivery,
} from "./deliver-unclaimed-answer.js";
import { buildResolveConflictError } from "./pending-interactions.js";
import { toPendingInteraction } from "./pending-interaction-serialization.js";

export type UnclaimedPluginAnswerDeliverer = (args: {
  delivery: UnclaimedAnswerDelivery;
  claimInTransaction: (tx: DbTransaction) => void;
}) => Promise<void>;

const LATE_ANSWER_RESOLUTION = {
  kind: "plugin_submitted",
  description: { title: "Answered after the question timed out" },
} satisfies PendingInteractionResolution;

const ASK_USER_QUESTION_ID = "ask-user-question";

export function isLateAnswerRecoverable(
  interaction: PluginPendingInteraction,
): boolean {
  return (
    interaction.status === "interrupted" &&
    interaction.statusReason === "timeout" &&
    interaction.origin.pluginId === ASK_USER_QUESTION_ID &&
    interaction.origin.rendererId === ASK_USER_QUESTION_ID
  );
}

export function isRecoveredLateAnswer(
  interaction: PendingInteraction,
): boolean {
  return (
    isPluginPendingInteraction(interaction) &&
    interaction.status === "resolved" &&
    interaction.origin.pluginId === ASK_USER_QUESTION_ID &&
    interaction.origin.rendererId === ASK_USER_QUESTION_ID &&
    interaction.resolution !== null &&
    isPluginPendingInteractionResolution(interaction.resolution) &&
    interaction.resolution.description?.title ===
      LATE_ANSWER_RESOLUTION.description.title
  );
}

interface LateAnswerHost {
  deliverer: UnclaimedPluginAnswerDeliverer | null;
  logger: ServerLogger;
  requireInteraction: (interactionId: string) => PendingInteraction;
  settle: (interaction: PendingInteraction) => void;
}

export async function recoverLateAnswer(
  host: LateAnswerHost,
  current: PluginPendingInteraction,
  value: JsonValue,
): Promise<PendingInteraction> {
  if (isRecoveredLateAnswer(current)) return current;
  if (!isLateAnswerRecoverable(current)) {
    throw buildResolveConflictError(current);
  }
  return deliverLateAnswer(host, current, value);
}

export async function lateAnswerOrConflict(
  host: LateAnswerHost,
  latest: PendingInteraction,
  value: JsonValue,
): Promise<PendingInteraction> {
  if (isPluginPendingInteraction(latest) && isLateAnswerRecoverable(latest)) {
    return deliverLateAnswer(host, latest, value);
  }
  throw buildResolveConflictError(latest);
}

async function deliverLateAnswer(
  host: LateAnswerHost,
  current: PluginPendingInteraction,
  value: JsonValue,
): Promise<PendingInteraction> {
  const deliverer = host.deliverer;
  if (deliverer === null) throw buildResolveConflictError(current);
  const delivery = planUnclaimedAnswerDelivery({
    interaction: current,
    value,
  });
  if (delivery === null) {
    throw new ApiError(
      400,
      "invalid_request",
      "The answer does not answer any of the questions that were asked",
    );
  }
  try {
    await deliverer({
      delivery,
      claimInTransaction: (tx) => {
        const claimed = setTimedOutPendingInteractionResolved(tx, {
          id: current.id,
          resolution: JSON.stringify(LATE_ANSWER_RESOLUTION),
        });
        if (claimed) return;
        const latest = getPendingInteraction(tx, current.id);
        throw buildResolveConflictError(
          latest ? toPendingInteraction(latest) : current,
        );
      },
    });
  } catch (error) {
    const latest = host.requireInteraction(current.id);
    if (isRecoveredLateAnswer(latest)) return latest;
    throw error;
  }
  const interaction = host.requireInteraction(current.id);
  host.logger.info(
    { interactionId: interaction.id, threadId: interaction.threadId },
    "Queued an answer that arrived after the provider stopped waiting for it",
  );
  host.settle(interaction);
  return interaction;
}
