import type {
  PluginSidebarThreadIndicator,
  PluginThreadStatusThread,
} from "../app-contract.js";

type PendingInteractionKind =
  PluginThreadStatusThread["pendingInteractionKind"];

export const FORK_INDICATOR_LABELS: Record<
  "waiting-for-plan-approval" | "waiting-for-answer",
  string
> = {
  "waiting-for-plan-approval": "Thread needs plan approval",
  "waiting-for-answer": "Thread is waiting for your answer",
};

export const FORK_INDICATORS_OVER_ROW_STATUS: PluginSidebarThreadIndicator[] = [
  "waiting-for-plan-approval",
  "waiting-for-answer",
];

export function waitingIndicatorForPendingInteraction(
  kind: string | null,
): "waiting-for-input" | "waiting-for-plan-approval" | "waiting-for-answer" {
  if (kind === "plan_approval") return "waiting-for-plan-approval";
  if (kind === "question") return "waiting-for-answer";
  return "waiting-for-input";
}

export function sharedPendingInteractionKind(
  kinds: readonly PendingInteractionKind[],
): PendingInteractionKind {
  let shared: PendingInteractionKind = null;
  let decided = false;
  for (const kind of kinds) {
    shared = decided ? (shared === kind ? shared : null) : kind;
    decided = true;
  }
  return shared;
}

export function refinePendingIndicator(
  indicator: PluginSidebarThreadIndicator,
  thread: PluginThreadStatusThread | null,
  hiddenThreads: readonly PluginThreadStatusThread[],
): PluginSidebarThreadIndicator {
  if (indicator !== "waiting-for-input") return indicator;
  const pendingThreads = [thread, ...hiddenThreads].filter(
    (candidate): candidate is PluginThreadStatusThread =>
      candidate !== null && candidate.hasPendingInteraction,
  );
  return waitingIndicatorForPendingInteraction(
    sharedPendingInteractionKind(
      pendingThreads.map(
        (pendingThread) => pendingThread.pendingInteractionKind,
      ),
    ),
  );
}
