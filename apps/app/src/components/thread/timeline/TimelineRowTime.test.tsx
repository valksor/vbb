// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import {
  commandRow,
  conversationRow,
  systemRow,
} from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";
import { TimelineReasoningExpansionProvider } from "./TimelineReasoningExpansion";
import {
  formatTimelineRowClock,
  resolveOngoingIndicatorStartedAt,
  WorkingLabelWithTime,
} from "./TimelineRowTime";
import { TimelineWorkingIndicator } from "./TimelineWorkingIndicator";

const commandStartedAt = new Date(2026, 9, 1, 9, 5, 7).getTime();
const thoughtStartedAt = new Date(2026, 9, 1, 13, 42, 0).getTime();
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

afterEach(() => {
  cleanup();
  client.clear();
});

describe("timeline row time", () => {
  it("formats a 24-hour hh:mm clock", () => {
    expect(formatTimelineRowClock(commandStartedAt)).toBe("09:05");
    expect(formatTimelineRowClock(thoughtStartedAt)).toBe("13:42");
  });

  it.each([
    {
      clock: "09:05",
      row: commandRow({
        id: "cmd-1",
        command: "pnpm test",
        startedAt: commandStartedAt,
      }),
    },
    {
      clock: "13:42",
      row: systemRow({
        id: "thread:op:reasoning:turn-1:item-1",
        systemKind: "operation",
        operationKind: "reasoning",
        title: "Thought for 12s",
        detail: "Compare both render paths.",
        status: "completed",
        startedAt: thoughtStartedAt,
        completedAt: thoughtStartedAt + 12_000,
      }),
    },
  ])("prefixes the row header with $clock", ({ clock, row }) => {
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TimelineReasoningExpansionProvider>
            <ThreadTimelineRows
              timelineRows={[row]}
              threadRuntimeDisplayStatus="idle"
            />
          </TimelineReasoningExpansionProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText(clock).tagName).toBe("TIME");
  });

  it.each([
    { isThinking: false, label: "Working..." },
    { isThinking: true, label: "Thinking…" },
  ])("shows when the $label indicator started", ({ isThinking }) => {
    render(
      <TimelineReasoningExpansionProvider>
        <TimelineWorkingIndicator
          isThinking={isThinking}
          startedAt={thoughtStartedAt}
        />
      </TimelineReasoningExpansionProvider>,
    );

    expect(screen.getByText("13:42").tagName).toBe("TIME");
  });

  it("uses selected active thinking instead of the last row activity", () => {
    const activeThinkingStartedAt = thoughtStartedAt + 30_000;
    const lastRow = systemRow({
      id: "thread:op:reasoning:turn-1:item-2",
      systemKind: "operation",
      operationKind: "reasoning",
      title: "Thought for 12s",
      detail: "Compare both render paths.",
      status: "completed",
      startedAt: thoughtStartedAt,
      completedAt: thoughtStartedAt + 12_000,
    });

    expect(
      resolveOngoingIndicatorStartedAt(
        true,
        { startedAt: activeThinkingStartedAt },
        [lastRow],
      ),
    ).toBe(activeThinkingStartedAt);
  });

  it("uses the last row completedAt when active thinking is not selected", () => {
    const completedAt = thoughtStartedAt + 12_000;
    const lastRow = systemRow({
      id: "thread:op:reasoning:turn-1:item-3",
      systemKind: "operation",
      operationKind: "reasoning",
      title: "Thought for 12s",
      detail: "Compare both render paths.",
      status: "completed",
      startedAt: thoughtStartedAt,
      completedAt,
    });

    expect(
      resolveOngoingIndicatorStartedAt(
        false,
        { startedAt: thoughtStartedAt + 30_000 },
        [lastRow],
      ),
    ).toBe(completedAt);
  });

  it("uses startedAt when completedAt is null or absent, and none for empty rows", () => {
    const nullCompletedAtRow = systemRow({
      id: "thread:op:reasoning:turn-1:item-4",
      systemKind: "operation",
      operationKind: "reasoning",
      title: "Thought for 12s",
      detail: "Compare both render paths.",
      status: "completed",
      startedAt: thoughtStartedAt,
      completedAt: null,
    });
    const noCompletedAtRow = conversationRow({
      id: "conversation-1",
      text: "Existing message footer timestamps remain unchanged.",
      startedAt: commandStartedAt,
    });

    expect(
      resolveOngoingIndicatorStartedAt(false, undefined, [nullCompletedAtRow]),
    ).toBe(thoughtStartedAt);
    expect("completedAt" in noCompletedAtRow).toBe(false);
    expect(
      resolveOngoingIndicatorStartedAt(false, undefined, [noCompletedAtRow]),
    ).toBe(noCompletedAtRow.startedAt);
    expect(resolveOngoingIndicatorStartedAt(false, undefined, [])).toBeUndefined();
  });

  it("omits an undefined time and preserves zero with localized metadata", () => {
    const { rerender } = render(
      <WorkingLabelWithTime label="Working..." startedAt={undefined} />,
    );

    expect(document.querySelector("time")).toBeNull();

    rerender(<WorkingLabelWithTime label="Working..." startedAt={0} />);

    const time = screen.getByText(formatTimelineRowClock(0));
    expect(time.tagName).toBe("TIME");
    expect(time.getAttribute("dateTime")).toBe(new Date(0).toISOString());
    expect(time.getAttribute("title")).toBe(
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(0),
    );
  });
});
