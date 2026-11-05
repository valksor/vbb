import { useEffect, useRef, useState } from "react";
import {
  BACKGROUND_TASK_OUTPUT_DEFAULT_TAIL_BYTES,
  type BackgroundTaskOutputResponse,
  type TimelineWorkflowWorkRow,
} from "@bb/server-contract";
import { collapseCarriageReturns } from "@bb/text-utils";
import { LazyTerminalOutputBlock } from "@/components/thread/timeline/LazyTerminalOutputBlock";
import { useThreadBackgroundTaskOutput } from "@/hooks/queries/thread-queries.fork";
import { useDocumentVisible } from "@/lib/document-visibility";

export const BACKGROUND_COMMAND_OUTPUT_POLL_INTERVAL_MS = 1500;
const FINAL_FETCH_ATTEMPTS = 3;
const OUTPUT_ARIA_LABEL = "Command output";

const TRUNCATED_LABEL = `Showing last ${BACKGROUND_TASK_OUTPUT_DEFAULT_TAIL_BYTES / 1024} KB`;
const OUTPUT_SCROLL_CLASS = "max-h-[min(20rem,40dvh)]";

interface BackgroundCommandOutputPanelProps {
  id: string;
  labelledBy: string;
  threadId: string;
  row: TimelineWorkflowWorkRow;
  finished: boolean;
  onEscape: () => void;
}

type FinalFetchStatus = "fetching" | "retrying" | "done" | "failed";

interface BackgroundCommandOutputView {
  text: string;
  truncated: boolean;
  totalBytes: number;
  running: boolean;
  retrying: boolean;
  finalFailed: boolean;
  retryFinalFetch: () => void;
  message: string | null;
  announcement: string;
}

function statusMessage(args: {
  waiting: boolean;
  unavailable: boolean;
  finalFailed: boolean;
  loading: boolean;
  hasText: boolean;
  retrying: boolean;
}): string | null {
  if (args.unavailable) {
    return args.hasText
      ? "Output is no longer readable; showing last captured output"
      : "Output isn't available for this command";
  }
  if (args.finalFailed) return "Couldn't load the final output";
  if (args.waiting) return "Waiting for output…";
  if (args.loading) return "Loading output…";
  if (!args.hasText && !args.retrying) return "No output yet";
  return null;
}

function isFinalResult(result: {
  isError: boolean;
  data: BackgroundTaskOutputResponse | undefined;
}): boolean {
  return (
    !result.isError &&
    (result.data?.state === "available" || result.data?.state === "unavailable")
  );
}

function useBackgroundCommandOutput(
  threadId: string,
  row: TimelineWorkflowWorkRow,
  finished: boolean,
): BackgroundCommandOutputView {
  const isVisible = useDocumentVisible();
  const running = !finished && row.status === "pending";
  const [finalStatus, setFinalStatus] = useState<FinalFetchStatus>("fetching");
  const [finalRun, setFinalRun] = useState(0);
  const query = useThreadBackgroundTaskOutput(
    { threadId, itemId: row.itemId },
    {
      enabled: row.outputAvailable || finished,
      pollIntervalMs:
        running && isVisible
          ? BACKGROUND_COMMAND_OUTPUT_POLL_INTERVAL_MS
          : false,
      settled: finished && finalStatus === "done",
    },
  );
  const { data, refetch } = query;

  const [lastGood, setLastGood] = useState<BackgroundTaskOutputResponse | null>(
    null,
  );
  if (data?.state === "available" && data !== lastGood) {
    setLastGood(data);
  }

  const wasRunning = useRef(running);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (wasRunning.current && !running) {
      setAnnouncement("Command finished");
    }
    wasRunning.current = running;
  }, [running]);

  useEffect(() => {
    if (!finished) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = async (attemptNumber: number): Promise<void> => {
      const result = await refetch();
      if (cancelled) return;
      if (isFinalResult(result)) {
        setFinalStatus("done");
        return;
      }
      if (attemptNumber >= FINAL_FETCH_ATTEMPTS) {
        setFinalStatus("failed");
        return;
      }
      setFinalStatus("retrying");
      timer = setTimeout(() => {
        void attempt(attemptNumber + 1);
      }, BACKGROUND_COMMAND_OUTPUT_POLL_INTERVAL_MS);
    };
    void attempt(1);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [finished, refetch, finalRun]);

  const text = collapseCarriageReturns(lastGood?.text ?? "");
  const unavailable =
    data?.state === "unavailable" ||
    (!row.outputAvailable && !running && !finished);
  const retrying =
    !unavailable &&
    (finished
      ? finalStatus === "retrying"
      : query.isError || data?.state === "busy");
  return {
    text,
    truncated: lastGood?.truncated ?? false,
    totalBytes: lastGood?.totalBytes ?? 0,
    running,
    retrying,
    finalFailed: finished && finalStatus === "failed",
    retryFinalFetch: () => {
      setFinalStatus("fetching");
      setFinalRun((run) => run + 1);
    },
    message: statusMessage({
      waiting: !row.outputAvailable && running,
      unavailable,
      finalFailed: finished && finalStatus === "failed",
      loading:
        (row.outputAvailable || finished) &&
        lastGood === null &&
        query.isPending,
      hasText: text !== "",
      retrying,
    }),
    announcement,
  };
}

export function BackgroundCommandOutputPanel({
  id,
  labelledBy,
  threadId,
  row,
  finished,
  onEscape,
}: BackgroundCommandOutputPanelProps) {
  const view = useBackgroundCommandOutput(threadId, row, finished);

  return (
    <div
      id={id}
      role="region"
      aria-labelledby={labelledBy}
      className="flex min-w-0 flex-col gap-1.5 px-3 py-2"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onEscape();
        }
      }}
    >
      <LazyTerminalOutputBlock
        commandLine={row.command ?? row.description}
        output={view.text}
        exitCode={null}
        metadataLines={view.truncated ? [TRUNCATED_LABEL] : []}
        streaming={view.running}
        scrollClassName={OUTPUT_SCROLL_CLASS}
        scrollAriaLabel={OUTPUT_ARIA_LABEL}
      />
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        {view.message ? <span>{view.message}</span> : null}
        {view.finalFailed ? (
          <button
            type="button"
            onClick={view.retryFinalFetch}
            className="min-h-6 cursor-pointer rounded-sm px-1.5 text-foreground underline underline-offset-2 hover:bg-background/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            Retry
          </button>
        ) : null}
        {view.retrying ? (
          <span data-testid="background-command-retrying">Retrying…</span>
        ) : null}
        {finished ? <span>Finished</span> : null}
        <span className="min-w-0 break-all font-mono text-2xs text-subtle-foreground">
          {`Task ${row.itemId}`}
        </span>
      </div>
      <span role="status" className="sr-only">
        {view.announcement}
      </span>
    </div>
  );
}
