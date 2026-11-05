import { Command } from "commander";
import { isBackgroundAgentTaskType } from "@bb/domain";
import {
  BACKGROUND_TASK_OUTPUT_MAX_TAIL_BYTES,
  type BackgroundTaskOutputResponse,
  type ThreadTimelineResponse,
  type TimelineWorkflowWorkRow,
} from "@bb/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { outputJson, requireThreadIdOrSelf } from "../helpers.js";
import {
  sanitizeBackgroundListingText,
  sanitizeBackgroundOutput,
} from "./background-output.js";

interface ThreadBackgroundCommandOptions {
  self?: boolean;
  json?: boolean;
  task?: string;
  tailBytes?: string;
  raw?: boolean;
}

interface BackgroundTaskListing {
  itemId: string;
  kind: "command" | "agent";
  status: TimelineWorkflowWorkRow["taskStatus"];
  startedAt: number;
  elapsedMs: number;
  command: string | null;
  description: string;
  outputAvailable: boolean;
}

function parseTailBytes(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (
    !/^\d+$/.test(value) ||
    parsed < 1 ||
    parsed > BACKGROUND_TASK_OUTPUT_MAX_TAIL_BYTES
  ) {
    throw new Error(
      `--tail-bytes must be an integer between 1 and ${BACKGROUND_TASK_OUTPUT_MAX_TAIL_BYTES}.`,
    );
  }
  return parsed;
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function toListing(
  row: TimelineWorkflowWorkRow,
  now: number,
): BackgroundTaskListing {
  return {
    itemId: row.itemId,
    kind: isBackgroundAgentTaskType(row.taskType) ? "agent" : "command",
    status: row.taskStatus,
    startedAt: row.startedAt,
    elapsedMs: Math.max(0, now - row.startedAt),
    command: row.command,
    description: row.description,
    outputAvailable: row.outputAvailable,
  };
}

function describeListing(listing: BackgroundTaskListing): string {
  const text = sanitizeBackgroundListingText(
    listing.command ?? listing.description,
  );
  const label = listing.kind === "agent" ? `[agent] ${text}` : text;
  return [
    listing.itemId,
    listing.status,
    formatElapsed(listing.elapsedMs),
    label,
  ].join("  ");
}

type CliSdk = ReturnType<typeof createCliBbSdk>;

async function listBackgroundTasks(
  timeline: ThreadTimelineResponse,
  threadId: string,
  opts: ThreadBackgroundCommandOptions,
): Promise<void> {
  const now = Date.now();
  const listings = timeline.activeBackgroundCommands.map((row) =>
    toListing(row, now),
  );
  if (outputJson(opts, { threadId, tasks: listings })) return;
  if (listings.length === 0) {
    console.log("No background commands running.");
    return;
  }
  for (const listing of listings) {
    console.log(describeListing(listing));
  }
}

function printTaskOutput(
  itemId: string,
  result: BackgroundTaskOutputResponse,
  raw: boolean | undefined,
): void {
  if (result.state === "unavailable") {
    throw new Error(
      `Output isn't available for task ${itemId}. It may not be a background command, or its output file is gone.`,
    );
  }
  if (result.state === "pending") {
    console.error(
      `Task ${itemId} has not written an output file yet. Try again shortly.`,
    );
    return;
  }
  if (result.state === "busy") {
    console.error(
      `Task ${itemId} output is changing too quickly to read. Try again.`,
    );
    return;
  }
  if (result.truncated) {
    console.error(
      `Output truncated to its tail; the full output is ${result.totalBytes} bytes.`,
    );
  }
  if (result.text.length === 0) {
    console.error(`Task ${itemId} has not produced output yet.`);
    return;
  }
  const text = raw ? result.text : sanitizeBackgroundOutput(result.text);
  console.log(text.replace(/\n$/, ""));
}

async function readTaskOutput(args: {
  sdk: CliSdk;
  timeline: ThreadTimelineResponse;
  threadId: string;
  itemId: string;
  tailBytes: number | undefined;
  opts: ThreadBackgroundCommandOptions;
}): Promise<void> {
  const activeTask = args.timeline.activeBackgroundCommands.find(
    (row) => row.itemId === args.itemId,
  );
  if (activeTask && isBackgroundAgentTaskType(activeTask.taskType)) {
    throw new Error(
      `Task ${args.itemId} is a background agent; only background commands have output.`,
    );
  }
  const result = await args.sdk.threads.experimental_backgroundTaskOutput({
    threadId: args.threadId,
    itemId: args.itemId,
    ...(args.tailBytes === undefined ? {} : { tailBytes: args.tailBytes }),
  });
  if (
    outputJson(args.opts, {
      threadId: args.threadId,
      itemId: args.itemId,
      ...result,
    })
  ) {
    return;
  }
  printTaskOutput(args.itemId, result, args.opts.raw);
}

export function registerBackgroundCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("background [id]")
    .description(
      "List a thread's active background commands, or print one command's output tail with --task",
    )
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option(
      "--task <itemId>",
      "Print the output tail of this background command (item id from the listing)",
    )
    .option(
      "--tail-bytes <n>",
      `With --task, how many trailing bytes to read (default 65536, max ${BACKGROUND_TASK_OUTPUT_MAX_TAIL_BYTES})`,
    )
    .option(
      "--raw",
      "With --task, print the output unmodified instead of stripping control and OSC sequences (SGR colors are kept either way). Raw output can contain terminal control sequences.",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          id: string | undefined,
          opts: ThreadBackgroundCommandOptions,
        ) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const tailBytes = parseTailBytes(opts.tailBytes);
          if (
            opts.task === undefined &&
            (tailBytes !== undefined || opts.raw)
          ) {
            throw new Error("--tail-bytes and --raw require --task.");
          }
          const sdk = createCliBbSdk(getUrl());
          const timeline = await sdk.threads.timeline({
            threadId,
            summaryOnly: "true",
          });
          if (opts.task === undefined) {
            await listBackgroundTasks(timeline, threadId, opts);
            return;
          }
          await readTaskOutput({
            sdk,
            timeline,
            threadId,
            itemId: opts.task,
            tailBytes,
            opts,
          });
        },
      ),
    );
}
