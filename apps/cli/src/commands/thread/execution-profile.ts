import {
  BbHttpError,
  type BbSdk,
  type ThreadExecutionProfileResult,
} from "@bb/sdk";

export type { ThreadExecutionProfileResult };

export function printExecutionProfile(
  execution: ThreadExecutionProfileResult | null,
): void {
  if (execution === null) return;
  const describe = (value: {
    model: string;
    reasoningLevel: string;
    permissionMode: string;
    serviceTier: string;
  }) =>
    `${value.model} · ${value.reasoningLevel} · ${value.permissionMode} · ${value.serviceTier}`;
  console.log("  Execution:");
  console.log(
    `    Next turn:      ${execution.nextTurn ? describe(execution.nextTurn) : "(none)"}`,
  );
  const { model, reasoningLevel } = execution.overrides;
  console.log(
    `    Overrides:      ${model === null && reasoningLevel === null ? "none (defaults apply)" : `model ${model ?? "default"} · reasoning ${reasoningLevel ?? "default"}`}`,
  );
  console.log(
    `    Last requested: ${execution.lastRequested ? describe(execution.lastRequested) : "(no turn yet)"}`,
  );
  const { executed } = execution;
  console.log(
    `    Executed:       ${executed ? `${executed.model} · ${executed.reasoningLevel ?? "unreported"} · ${executed.permissionMode ?? "unreported"} · ${executed.serviceTier ?? "unreported"}` : "not reported by the provider"}`,
  );
  if (executed !== null) {
    console.log(
      `    Reported:       ${new Date(executed.reportedAt).toLocaleString()}`,
    );
  }
}

export async function fetchExecutionProfile(args: {
  sdk: BbSdk;
  threadId: string;
}): Promise<ThreadExecutionProfileResult | null> {
  try {
    return await args.sdk.threads.experimental_executionProfile({
      threadId: args.threadId,
    });
  } catch (error) {
    if (error instanceof BbHttpError && error.status === 404) {
      return null;
    }
    throw error;
  }
}
