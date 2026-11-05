import { z } from "zod";
import type { ThreadEventType } from "./provider-event.js";
import type { systemProviderTurnWatchdogEventDataSchema } from "./thread-events.js";
import {
  threadEventScopeDefinitionByType,
  threadEventScopePolicyByType,
} from "./thread-event-scope.js";

type ThreadEventTypeForScopePolicy<Policy extends "thread" | "thread-or-turn"> =
  {
    [
      Type in ThreadEventType
    ]: (typeof threadEventScopeDefinitionByType)[Type]["policy"] extends Policy
      ? Type
      : never;
  }[ThreadEventType];

export type ThreadOnlyThreadEventType = ThreadEventTypeForScopePolicy<"thread">;

export const providerTurnWatchdogActivityEventTypeValues = [
  "turn/started",
  "turn/input/accepted",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/plan/delta",
  "item/mcpToolCall/progress",
  "item/toolCall/progress",
  "item/backgroundTask/progress",
  "item/backgroundTask/completed",
  "item/delegation/progress",
  "item/delegation/completed",
  "turn/plan/updated",
  "turn/diff/updated",
  "provider/error",
  "provider/warning",
] as const satisfies readonly ThreadEventType[];
export const providerTurnWatchdogActivityEventTypeSchema = z.enum(
  providerTurnWatchdogActivityEventTypeValues,
);
export type ProviderTurnWatchdogActivityEventType = z.infer<
  typeof providerTurnWatchdogActivityEventTypeSchema
>;

export type ProviderTurnWatchdogThreadScopedActivityEventType = Extract<
  ProviderTurnWatchdogActivityEventType,
  ThreadOnlyThreadEventType
>;

export const providerTurnWatchdogThreadScopedActivityEventTypeValues: readonly ProviderTurnWatchdogThreadScopedActivityEventType[] =
  providerTurnWatchdogActivityEventTypeValues.filter(
    (
      eventType,
    ): eventType is ProviderTurnWatchdogThreadScopedActivityEventType =>
      threadEventScopePolicyByType[eventType] === "thread",
  );

export * from "./provider-turn-watchdog-action.fork.js";
export * from "./provider-turn-idle-settings.fork.js";

export type SystemProviderTurnWatchdogEventData = z.infer<
  typeof systemProviderTurnWatchdogEventDataSchema
>;
