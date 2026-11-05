import { useEffect, useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import type {
  BackgroundTaskOutputResponse,
  TimelineWorkflowWorkRow,
} from "@bb/server-contract";
import { createAppQueryClient } from "@/lib/query-client";
import { sdk } from "@/lib/sdk";
import { ThreadBackgroundCommandsCard } from "./ThreadBackgroundCommandsCard";
import { backgroundCommandRow } from "@/test/fixtures/thread-timeline-rows";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";
import { FauxComposer, ResponsiveStage } from "./banner-story-stages";

export default {
  title: "promptbox/banner/Background Commands Card Fork",
};

const runningCommand = (
  args: Parameters<typeof backgroundCommandRow>[0],
): TimelineWorkflowWorkRow =>
  backgroundCommandRow({
    status: "pending",
    taskStatus: "running",
    summary: null,
    ...args,
  });

const single: TimelineWorkflowWorkRow[] = [
  runningCommand({
    id: "thr_fixture:bg:tail-dev-log",
    description: "Poll all CI runs for batching head until completion",
    command: "gh run watch --exit-status",
    outputAvailable: true,
    startedAt: Date.now() - 8_000,
  }),
];

const many: TimelineWorkflowWorkRow[] = [
  runningCommand({
    id: "thr_fixture:bg:dev-server",
    description: "Run the dev server",
    command: "pnpm exec turbo run dev --filter=@bb/app",
    outputAvailable: true,
    startedAt: Date.now() - 26_000,
  }),
  runningCommand({
    id: "thr_fixture:bg:watch-tests",
    description: "Watch and re-run tests",
    command: "pnpm exec vitest watch",
    outputAvailable: true,
    startedAt: Date.now() - 12_000,
  }),
  runningCommand({
    id: "thr_fixture:bg:tail-log",
    description: "Tail the dev server log",
    command: null,
    outputAvailable: false,
    startedAt: Date.now() - 4_000,
  }),
];

const longCommand: TimelineWorkflowWorkRow[] = [
  runningCommand({
    id: "thr_fixture:bg:ladle",
    description:
      "cd /Users/fixture/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_fixture-1/bb/apps/app && (pnpm exec ladle serve --port 61234 > $TMPDIR/ladle.log 2>&1 &) ; for i in $(seq 1 40); do curl -s localhost:61234/meta.json >/dev/null && break; sleep 2; done",
    startedAt: Date.now() - 74_000,
  }),
];

const STORY_THREAD_ID = "thr_fixture";

const OUTPUT_LINES = Array.from(
  { length: 400 },
  (_, index) =>
    `\u001b[32m[${index + 1}]\u001b[0m compiled module ${index + 1}`,
);

function scriptedOutput(
  itemId: string,
  tick: number,
): BackgroundTaskOutputResponse {
  if (itemId === "bg_missing") {
    return { state: "unavailable", text: "", truncated: false, totalBytes: 0 };
  }
  const text = OUTPUT_LINES.slice(0, Math.min(tick * 5, OUTPUT_LINES.length))
    .map((line) => `${line}\n`)
    .join("");
  return {
    state: tick === 0 ? "pending" : "available",
    text,
    truncated: false,
    totalBytes: text.length,
  };
}

function StoryOutputProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => createAppQueryClient());
  const [original] = useState(
    () => sdk.threads.experimental_backgroundTaskOutput,
  );
  const [ticks] = useState(() => new Map<string, number>());
  useState(() => {
    sdk.threads.experimental_backgroundTaskOutput = async ({ itemId }) => {
      const tick = ticks.get(itemId) ?? 0;
      ticks.set(itemId, tick + 1);
      return scriptedOutput(itemId, tick);
    };
  });
  useEffect(
    () => () => {
      sdk.threads.experimental_backgroundTaskOutput = original;
    },
    [original],
  );
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const missingOutput: TimelineWorkflowWorkRow[] = [
  runningCommand({
    id: "thr_fixture:bg:missing",
    itemId: "bg_missing",
    description: "Build the docs site",
    command: "pnpm --filter docs build",
    outputAvailable: true,
    startedAt: Date.now() - 31_000,
  }),
];

function ExpandableCard({
  commands,
  startExpanded = false,
}: {
  commands: TimelineWorkflowWorkRow[];
  startExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(startExpanded);
  return (
    <div className="flex flex-col gap-2">
      <ThreadBackgroundCommandsCard
        threadId={STORY_THREAD_ID}
        commands={commands}
        isExpanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
      />
      <FauxComposer />
    </div>
  );
}

export function Overview() {
  return (
    <StoryOutputProvider>
      <StoryCard>
        <StoryRow
          label="single"
          hint="compact: summarized and expandable; wide: detailed single line"
        >
          <ResponsiveStage>
            <ExpandableCard commands={single} />
          </ResponsiveStage>
        </StoryRow>
        <StoryRow
          label="multiple (collapsed)"
          hint="most recent command + total count; click to expand"
        >
          <ResponsiveStage>
            <ExpandableCard commands={many} />
          </ResponsiveStage>
        </StoryRow>
        <StoryRow
          label="multiple (expanded)"
          hint="expanded: the other running commands listed below the primary"
        >
          <ResponsiveStage>
            <ExpandableCard commands={many} startExpanded />
          </ResponsiveStage>
        </StoryRow>
        <StoryRow
          label="output unavailable"
          hint="the output file is gone; expand the row to see the message"
        >
          <ResponsiveStage>
            <ExpandableCard commands={missingOutput} />
          </ResponsiveStage>
        </StoryRow>
        <StoryRow
          label="long command (expanded)"
          hint="compact rows clamp the command to two lines"
        >
          <ResponsiveStage>
            <ExpandableCard commands={longCommand} startExpanded />
          </ResponsiveStage>
        </StoryRow>
      </StoryCard>
    </StoryOutputProvider>
  );
}
