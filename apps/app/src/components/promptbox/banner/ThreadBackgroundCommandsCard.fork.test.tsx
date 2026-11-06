// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineWorkflowWorkRow } from "@bb/server-contract";
import type { TerminalOutputBlockProps } from "@/components/thread/timeline/TerminalOutputBlock";
import {
  backgroundCommandRow,
  workflowRow,
} from "@/test/fixtures/thread-timeline-rows";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { ThreadBackgroundCommandsCard } from "./ThreadBackgroundCommandsCard.fork";

const backgroundTaskOutput = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { experimental_backgroundTaskOutput: backgroundTaskOutput } },
}));

vi.mock("@/lib/ws", () => ({
  wsManager: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));

vi.mock("@/components/thread/timeline/LazyTerminalOutputBlock", () => ({
  LazyTerminalOutputBlock: (props: TerminalOutputBlockProps) => (
    <div
      data-testid="terminal"
      data-streaming={String(props.streaming)}
      data-scroll-class={props.scrollClassName}
      data-scroll-label={props.scrollAriaLabel}
    >
      <div data-testid="terminal-command">{props.commandLine}</div>
      <div data-testid="terminal-output">{props.output}</div>
      <div data-testid="terminal-meta">{props.metadataLines.join("|")}</div>
    </div>
  ),
}));

const THREAD_ID = "thr_test";

let resizeObserverCallback: ResizeObserverCallback | null = null;
let resizeObserver: TestResizeObserver | null = null;

class TestResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeObserverCallback = callback;
    resizeObserver = this;
  }

  observe() {}
  unobserve() {}
  disconnect() {}
}

function reportCardWidth(target: Element, width: number): void {
  if (!resizeObserverCallback || !resizeObserver) {
    throw new Error("Expected the background card to observe its width.");
  }
  const callback = resizeObserverCallback;
  const observer = resizeObserver;
  const size: ResizeObserverSize = { inlineSize: width, blockSize: 32 };
  const entry: ResizeObserverEntry = {
    target,
    contentRect: new DOMRect(0, 0, width, 32),
    borderBoxSize: [size],
    contentBoxSize: [size],
    devicePixelContentBoxSize: [size],
  };
  act(() => callback([entry], observer));
}

beforeEach(() => {
  backgroundTaskOutput.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resizeObserverCallback = null;
  resizeObserver = null;
});

describe("ThreadBackgroundCommandsCard", () => {
  it("summarizes and expands a single background command in compact mode", () => {
    const description = "Poll all CI runs for batching head until completion";
    const command = "gh run watch --exit-status";
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    backgroundTaskOutput.mockResolvedValue(pendingOutput());
    const { wrapper: Wrapper } = createQueryClientTestHarness();

    render(
      <Wrapper>
        <CompactViewportOverrideProvider isCompactViewport>
          <ThreadBackgroundCommandsCard
            threadId={THREAD_ID}
            commands={[
              backgroundCommandRow({
                command,
                description,
                outputAvailable: true,
                startedAt: 1,
                status: "pending",
                taskStatus: "running",
              }),
            ]}
            isExpanded={false}
            onToggle={() => {}}
          />
        </CompactViewportOverrideProvider>
      </Wrapper>,
    );

    const toggle = screen.getByRole("button", {
      name: "Running 1 background command",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(setIntervalSpy).not.toHaveBeenCalled();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(description).textContent).toBe(description);
    expect(screen.getByTestId("terminal-command").textContent).toBe(command);
  });

  it("uses the card width when a narrow composer sits in a wide viewport", () => {
    const description = "Poll all CI runs for batching head until completion";
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    render(
      <CompactViewportOverrideProvider isCompactViewport={false}>
        <ThreadBackgroundCommandsCard
          threadId={THREAD_ID}
          commands={[
            backgroundCommandRow({
              description,
              startedAt: 1,
              status: "pending",
              taskStatus: "running",
            }),
          ]}
          isExpanded={false}
          onToggle={() => {}}
        />
      </CompactViewportOverrideProvider>,
    );

    const card = screen.getByRole("region", { name: "Background commands" });
    expect(
      screen.getByRole("button", {
        name: `Background command: ${description}`,
      }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Running 1 background command" }),
    ).toBeNull();

    reportCardWidth(card, 320);

    expect(
      screen.getByRole("button", { name: "Running 1 background command" }),
    ).not.toBeNull();
  });

  it("summarizes and expands a single background agent in compact mode", () => {
    const description = "Inspect mobile background banner";

    function CompactCard() {
      const [isExpanded, setIsExpanded] = useState(false);
      return (
        <CompactViewportOverrideProvider isCompactViewport>
          <ThreadBackgroundCommandsCard
            threadId={THREAD_ID}
            commands={[
              workflowRow({
                description,
                model: "haiku",
                startedAt: 1,
                status: "pending",
                taskStatus: "running",
                taskType: "local_agent",
                workflowName: null,
              }),
            ]}
            isExpanded={isExpanded}
            onToggle={() => setIsExpanded((value) => !value)}
          />
        </CompactViewportOverrideProvider>
      );
    }

    render(<CompactCard />);

    const toggle = screen.getByRole("button", {
      name: "Running 1 background agent",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(description).textContent).toBe(description);
    expect(screen.getByTitle("Model: haiku").textContent).toBe("haiku");
  });

  it("keeps the detailed single-agent summary on wider screens", () => {
    const description = "Inspect mobile background banner";
    render(
      <CompactViewportOverrideProvider isCompactViewport={false}>
        <ThreadBackgroundCommandsCard
          threadId={THREAD_ID}
          commands={[
            workflowRow({
              description,
              model: "haiku",
              startedAt: Date.now() - 2_000,
              status: "pending",
              taskStatus: "running",
              taskType: "local_agent",
              workflowName: null,
            }),
          ]}
          isExpanded={false}
          onToggle={() => {}}
        />
      </CompactViewportOverrideProvider>,
    );

    const item = screen.getByLabelText(
      `Background agent: ${description} · Model haiku`,
    );
    expect(item.textContent).toContain("Running background agent:");
    expect(item.textContent).toContain(description);
    expect(screen.getByTitle("Model: haiku").textContent).toBe("haiku");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

function pendingOutput() {
  return {
    state: "pending" as const,
    text: "",
    truncated: false,
    totalBytes: 0,
  };
}

function busyOutput() {
  return {
    state: "busy" as const,
    text: "",
    truncated: false,
    totalBytes: 0,
  };
}

function unavailableOutput() {
  return {
    state: "unavailable" as const,
    text: "",
    truncated: false,
    totalBytes: 0,
  };
}

function availableOutput(
  text: string,
  overrides: { truncated?: boolean; totalBytes?: number } = {},
) {
  return {
    state: "available" as const,
    text,
    truncated: overrides.truncated ?? false,
    totalBytes: overrides.totalBytes ?? text.length,
  };
}

function runningCommand(
  itemId: string,
  overrides: Parameters<typeof backgroundCommandRow>[0] = {},
): TimelineWorkflowWorkRow {
  return backgroundCommandRow({
    id: `${THREAD_ID}:bg:${itemId}`,
    itemId,
    command: `run ${itemId}`,
    description: `Describe ${itemId}`,
    outputAvailable: true,
    startedAt: Date.now() - 5_000,
    status: "pending",
    taskStatus: "running",
    ...overrides,
  });
}

function StatefulCard({
  commands,
  startExpanded = false,
  compact = false,
}: {
  commands: TimelineWorkflowWorkRow[];
  startExpanded?: boolean;
  compact?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(startExpanded);
  return (
    <CompactViewportOverrideProvider isCompactViewport={compact}>
      <ThreadBackgroundCommandsCard
        threadId={THREAD_ID}
        commands={commands}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((value) => !value)}
      />
    </CompactViewportOverrideProvider>
  );
}

function renderStatefulCard(
  commands: TimelineWorkflowWorkRow[],
  startExpanded = false,
  compact = false,
) {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  const view = render(
    <StatefulCard
      commands={commands}
      startExpanded={startExpanded}
      compact={compact}
    />,
    { wrapper: Wrapper },
  );
  return {
    ...view,
    update: (next: TimelineWorkflowWorkRow[]) =>
      view.rerender(
        <StatefulCard
          commands={next}
          startExpanded={startExpanded}
          compact={compact}
        />,
      ),
  };
}

async function flushQueries() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advancePolling(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await vi.advanceTimersByTimeAsync(10);
  });
}

function rowTrigger(itemId: string): HTMLElement {
  const trigger = document.getElementById(
    `thread-background-command-trigger-${itemId}`,
  );
  if (!trigger) throw new Error(`Missing row trigger for ${itemId}`);
  return trigger;
}

function headerToggle(): HTMLElement {
  const toggle = document.getElementById(
    "thread-background-commands-card-toggle",
  );
  if (!toggle) throw new Error("Missing background commands header toggle");
  return toggle;
}

function headerCountBadge(): string | null {
  return within(headerToggle()).queryByText(/^\d+$/)?.textContent ?? null;
}

function setDocumentVisibility(state: "visible" | "hidden") {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("ThreadBackgroundCommandsCard command output", () => {
  it("opens a single command's detail from the header and requests its output by item id", async () => {
    vi.useFakeTimers();
    backgroundTaskOutput.mockResolvedValue(availableOutput("hello\n"));
    renderStatefulCard([runningCommand("item_a")]);

    const header = screen.getByRole("button", {
      name: "Background command: Describe item_a",
    });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(backgroundTaskOutput).not.toHaveBeenCalled();

    fireEvent.click(header);
    await flushQueries();

    expect(header.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(
      header.getAttribute("aria-controls")!,
    );
    expect(panel?.getAttribute("aria-labelledby")).toBe(header.id);
    expect(backgroundTaskOutput).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: THREAD_ID, itemId: "item_a" }),
    );
    expect(screen.getByTestId("terminal-command").textContent).toBe(
      "run item_a",
    );
    expect(screen.getByTestId("terminal-output").textContent).toBe("hello\n");
    expect(screen.getByTestId("terminal").dataset.streaming).toBe("true");
    expect(screen.getByTestId("terminal").dataset.scrollClass).toContain(
      "min(20rem,40dvh)",
    );
    expect(panel?.textContent).toContain("Task item_a");

    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("terminal")).toBeNull();
  });

  it("gives every command its own disclosure when several run, including the primary one", async () => {
    vi.useFakeTimers();
    backgroundTaskOutput.mockImplementation(
      async ({ itemId }: { itemId: string }) =>
        availableOutput(`output of ${itemId}`),
    );
    renderStatefulCard(
      [runningCommand("item_a"), runningCommand("item_b")],
      true,
    );

    const triggerA = rowTrigger("item_a");
    const triggerB = rowTrigger("item_b");
    expect(triggerA.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(triggerA);
    await flushQueries();
    expect(triggerA.getAttribute("aria-expanded")).toBe("true");
    expect(triggerA.getAttribute("aria-controls")).toBe(
      screen.getByTestId("terminal").closest("[role=region]")?.id,
    );
    expect(screen.getByTestId("terminal-output").textContent).toBe(
      "output of item_a",
    );

    fireEvent.click(triggerB);
    await flushQueries();
    expect(triggerA.getAttribute("aria-expanded")).toBe("false");
    expect(triggerB.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByTestId("terminal")).toHaveLength(1);
    expect(screen.getByTestId("terminal-output").textContent).toBe(
      "output of item_b",
    );
  });

  it("returns focus to the row trigger when Escape closes the panel", async () => {
    vi.useFakeTimers();
    backgroundTaskOutput.mockResolvedValue(availableOutput("x"));
    renderStatefulCard(
      [runningCommand("item_a"), runningCommand("item_b")],
      true,
    );
    const trigger = rowTrigger("item_b");
    fireEvent.click(trigger);
    await flushQueries();

    fireEvent.keyDown(screen.getByTestId("terminal"), { key: "Escape" });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps background agents non-expandable", () => {
    renderStatefulCard(
      [
        runningCommand("item_a"),
        workflowRow({
          id: "agent_row",
          description: "Inspect banner",
          startedAt: Date.now() - 2_000,
          status: "pending",
          taskStatus: "running",
          taskType: "local_agent",
          workflowName: null,
        }),
      ],
      true,
    );

    expect(
      document.querySelectorAll('[id^="thread-background-command-trigger-"]'),
    ).toHaveLength(1);
    expect(screen.getByText("Inspect banner")).not.toBeNull();
  });

  it("shows waiting text and does not fetch while the output file is unknown", async () => {
    vi.useFakeTimers();
    renderStatefulCard([runningCommand("item_a", { outputAvailable: false })]);

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await advancePolling(5_000);

    expect(screen.getByText("Waiting for output…")).not.toBeNull();
    expect(backgroundTaskOutput).not.toHaveBeenCalled();
  });

  it("starts polling when the row flips to output-available", async () => {
    vi.useFakeTimers();
    backgroundTaskOutput.mockResolvedValue(availableOutput("ready"));
    const view = renderStatefulCard([
      runningCommand("item_a", { outputAvailable: false }),
    ]);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(backgroundTaskOutput).not.toHaveBeenCalled();

    view.update([runningCommand("item_a", { outputAvailable: true })]);
    await flushQueries();

    expect(backgroundTaskOutput).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("terminal-output").textContent).toBe("ready");
  });

  it.each([
    ["pending state", pendingOutput()],
    ["an empty file", availableOutput("")],
  ])("shows 'No output yet' for %s", async (_name, response) => {
    vi.useFakeTimers();
    backgroundTaskOutput.mockResolvedValue(response);
    renderStatefulCard([runningCommand("item_a")]);

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await flushQueries();

    expect(screen.getByText("No output yet")).not.toBeNull();
  });

  it("shows the unavailable message and stops polling when the server says unavailable", async () => {
    vi.useFakeTimers();
    backgroundTaskOutput.mockResolvedValue({
      state: "unavailable",
      text: "",
      truncated: false,
      totalBytes: 0,
    });
    renderStatefulCard([runningCommand("item_a")]);

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await flushQueries();
    expect(
      screen.getByText("Output isn't available for this command"),
    ).not.toBeNull();
    const calls = backgroundTaskOutput.mock.calls.length;

    await advancePolling(6_000);

    expect(backgroundTaskOutput).toHaveBeenCalledTimes(calls);
  });

  it("keeps the last good text with a quiet retry indicator on busy and on errors", async () => {
    vi.useFakeTimers();
    backgroundTaskOutput
      .mockResolvedValueOnce(availableOutput("last good line"))
      .mockResolvedValueOnce({
        state: "busy",
        text: "",
        truncated: false,
        totalBytes: 0,
      })
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue(availableOutput("last good line\nnext"));
    renderStatefulCard([runningCommand("item_a")]);

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await flushQueries();
    expect(screen.getByTestId("terminal-output").textContent).toBe(
      "last good line",
    );
    expect(screen.queryByTestId("background-command-retrying")).toBeNull();

    await advancePolling(1_500);
    expect(screen.getByTestId("terminal-output").textContent).toBe(
      "last good line",
    );
    expect(screen.getByTestId("background-command-retrying")).not.toBeNull();

    await advancePolling(1_500);
    expect(screen.getByTestId("terminal-output").textContent).toBe(
      "last good line",
    );
    expect(screen.getByTestId("background-command-retrying")).not.toBeNull();

    await advancePolling(1_500);
    expect(screen.getByTestId("terminal-output").textContent).toBe(
      "last good line\nnext",
    );
    expect(screen.queryByTestId("background-command-retrying")).toBeNull();
  });

  it("collapses carriage-return overwrites and labels a truncated tail", async () => {
    vi.useFakeTimers();
    backgroundTaskOutput.mockResolvedValue(
      availableOutput("progress 10%\rprogress 100%\ndone\n", {
        truncated: true,
        totalBytes: 9_000_000,
      }),
    );
    renderStatefulCard([runningCommand("item_a")]);

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await flushQueries();

    expect(screen.getByTestId("terminal-output").textContent).toBe(
      "progress 100%\ndone\n",
    );
    expect(screen.getByTestId("terminal-meta").textContent).toBe(
      "Showing last 64 KB",
    );
  });

  it("polls about every 1.5 seconds and stops when the panel closes", async () => {
    vi.useFakeTimers();
    backgroundTaskOutput.mockResolvedValue(availableOutput("tick"));
    renderStatefulCard([runningCommand("item_a")]);
    const header = screen.getByRole("button", { expanded: false });

    fireEvent.click(header);
    await flushQueries();
    expect(backgroundTaskOutput).toHaveBeenCalledTimes(1);
    await advancePolling(1_500);
    expect(backgroundTaskOutput).toHaveBeenCalledTimes(2);
    await advancePolling(1_500);
    expect(backgroundTaskOutput).toHaveBeenCalledTimes(3);

    fireEvent.click(header);
    await advancePolling(6_000);

    expect(backgroundTaskOutput).toHaveBeenCalledTimes(3);
  });

  it("stops polling on unmount", async () => {
    vi.useFakeTimers();
    backgroundTaskOutput.mockResolvedValue(availableOutput("tick"));
    const view = renderStatefulCard([runningCommand("item_a")]);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await flushQueries();
    expect(backgroundTaskOutput).toHaveBeenCalledTimes(1);

    view.unmount();
    await advancePolling(6_000);

    expect(backgroundTaskOutput).toHaveBeenCalledTimes(1);
  });

  it("pauses polling while the document is hidden and resumes when visible", async () => {
    vi.useFakeTimers();
    backgroundTaskOutput.mockResolvedValue(availableOutput("tick"));
    renderStatefulCard([runningCommand("item_a")]);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await flushQueries();
    expect(backgroundTaskOutput).toHaveBeenCalledTimes(1);

    setDocumentVisibility("hidden");
    await advancePolling(6_000);
    expect(backgroundTaskOutput).toHaveBeenCalledTimes(1);

    setDocumentVisibility("visible");
    await advancePolling(1_500);
    expect(backgroundTaskOutput.mock.calls.length).toBeGreaterThan(1);
  });

  it("fetches once more after the command finishes, keeps the panel with a finished label, and stops polling", async () => {
    vi.useFakeTimers();
    backgroundTaskOutput
      .mockResolvedValueOnce(availableOutput("working"))
      .mockResolvedValue(availableOutput("working\nall done"));
    const view = renderStatefulCard([runningCommand("item_a")]);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await flushQueries();
    expect(backgroundTaskOutput).toHaveBeenCalledTimes(1);

    view.update([]);
    await flushQueries();

    expect(backgroundTaskOutput).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("terminal-output").textContent).toBe(
      "working\nall done",
    );
    expect(screen.getByText("Finished")).not.toBeNull();
    expect(screen.getByTestId("terminal").dataset.streaming).toBe("false");
    expect(screen.getByRole("status").textContent).toBe("Command finished");
    expect(
      screen
        .getByRole("button", { name: /Finished background command/ })
        .getAttribute("aria-expanded"),
    ).toBe("true");

    await advancePolling(6_000);
    expect(backgroundTaskOutput).toHaveBeenCalledTimes(2);

    fireEvent.click(
      screen.getByRole("button", { name: /Finished background command/ }),
    );
    expect(
      screen.queryByRole("region", { name: "Background commands" }),
    ).toBeNull();
  });

  it("does not put streaming output in a live region", async () => {
    vi.useFakeTimers();
    backgroundTaskOutput.mockResolvedValue(availableOutput("chatty"));
    renderStatefulCard([runningCommand("item_a")]);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await flushQueries();

    const output = screen.getByTestId("terminal-output");
    expect(output.closest("[aria-live]")).toBeNull();
    expect(output.closest("[role=status]")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
  });
  it("keeps Retrying only while final fetches remain, then reports that the final output could not load", async () => {
    vi.useFakeTimers();
    backgroundTaskOutput
      .mockResolvedValueOnce(availableOutput("working"))
      .mockResolvedValue(busyOutput());
    const view = renderStatefulCard([runningCommand("item_a")]);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await flushQueries();

    view.update([]);
    await flushQueries();
    expect(backgroundTaskOutput).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("background-command-retrying")).not.toBeNull();
    expect(screen.queryByText("Couldn't load the final output")).toBeNull();

    await advancePolling(1_500);
    expect(backgroundTaskOutput).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("background-command-retrying")).not.toBeNull();

    await advancePolling(1_500);
    expect(backgroundTaskOutput).toHaveBeenCalledTimes(4);
    expect(screen.queryByTestId("background-command-retrying")).toBeNull();
    expect(screen.getByText("Couldn't load the final output")).not.toBeNull();
    expect(screen.getByTestId("terminal-output").textContent).toBe("working");

    await advancePolling(6_000);
    expect(backgroundTaskOutput).toHaveBeenCalledTimes(4);
  });

  it("offers a Retry button after the final fetch fails that runs it again with a fresh budget", async () => {
    vi.useFakeTimers();
    backgroundTaskOutput
      .mockResolvedValueOnce(availableOutput("working"))
      .mockResolvedValueOnce(busyOutput())
      .mockResolvedValueOnce(busyOutput())
      .mockResolvedValueOnce(busyOutput())
      .mockResolvedValue(availableOutput("working\nfinal"));
    const view = renderStatefulCard([runningCommand("item_a")]);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await flushQueries();
    view.update([]);
    await flushQueries();
    await advancePolling(3_000);
    expect(screen.getByText("Couldn't load the final output")).not.toBeNull();
    expect(backgroundTaskOutput).toHaveBeenCalledTimes(4);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await flushQueries();

    expect(backgroundTaskOutput).toHaveBeenCalledTimes(5);
    expect(screen.queryByText("Couldn't load the final output")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByTestId("terminal-output").textContent).toBe(
      "working\nfinal",
    );
  });

  it("retries the final fetch after an error until the output is available", async () => {
    vi.useFakeTimers();
    backgroundTaskOutput
      .mockResolvedValueOnce(availableOutput("working"))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue(availableOutput("working\nfinal"));
    const view = renderStatefulCard([runningCommand("item_a")]);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await flushQueries();

    view.update([]);
    await flushQueries();
    expect(screen.getByTestId("background-command-retrying")).not.toBeNull();

    await advancePolling(1_500);

    expect(screen.queryByTestId("background-command-retrying")).toBeNull();
    expect(screen.queryByText("Couldn't load the final output")).toBeNull();
    expect(screen.getByTestId("terminal-output").textContent).toBe(
      "working\nfinal",
    );
    await advancePolling(6_000);
    expect(backgroundTaskOutput).toHaveBeenCalledTimes(3);
  });

  it("still makes the final fetch when the frozen row never had an output file", async () => {
    vi.useFakeTimers();
    backgroundTaskOutput.mockResolvedValue(availableOutput("late output"));
    const view = renderStatefulCard([
      runningCommand("item_a", { outputAvailable: false }),
    ]);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await advancePolling(3_000);
    expect(backgroundTaskOutput).not.toHaveBeenCalled();

    view.update([]);
    await flushQueries();

    expect(backgroundTaskOutput).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("terminal-output").textContent).toBe(
      "late output",
    );
    expect(screen.queryByText("Waiting for output…")).toBeNull();
  });

  it("reports unavailable after a final fetch for a frozen row without an output file", async () => {
    vi.useFakeTimers();
    backgroundTaskOutput.mockResolvedValue(unavailableOutput());
    const view = renderStatefulCard([
      runningCommand("item_a", { outputAvailable: false }),
    ]);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await flushQueries();

    view.update([]);
    await flushQueries();

    expect(backgroundTaskOutput).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Output isn't available for this command"),
    ).not.toBeNull();
    expect(screen.queryByTestId("background-command-retrying")).toBeNull();
  });

  it("keeps earlier text and says the file was removed when output becomes unavailable", async () => {
    vi.useFakeTimers();
    backgroundTaskOutput
      .mockResolvedValueOnce(availableOutput("captured before removal"))
      .mockResolvedValue(unavailableOutput());
    renderStatefulCard([runningCommand("item_a")]);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await flushQueries();

    await advancePolling(1_500);

    expect(screen.getByTestId("terminal-output").textContent).toBe(
      "captured before removal",
    );
    expect(
      screen.getByText(
        "Output is no longer readable; showing last captured output",
      ),
    ).not.toBeNull();
    expect(
      screen.queryByText("Output isn't available for this command"),
    ).toBeNull();
  });

  it("does not refetch on window focus once the final result is in", async () => {
    vi.useFakeTimers();
    backgroundTaskOutput.mockResolvedValue(availableOutput("done"));
    const view = renderStatefulCard([runningCommand("item_a")]);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await flushQueries();
    view.update([]);
    await flushQueries();
    const calls = backgroundTaskOutput.mock.calls.length;

    setDocumentVisibility("hidden");
    setDocumentVisibility("visible");
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await advancePolling(3_000);

    expect(backgroundTaskOutput).toHaveBeenCalledTimes(calls);
  });

  it("labels the output scroll area for keyboard users", async () => {
    vi.useFakeTimers();
    backgroundTaskOutput.mockResolvedValue(availableOutput("x"));
    renderStatefulCard([runningCommand("item_a")]);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await flushQueries();

    expect(screen.getByTestId("terminal").dataset.scrollLabel).toBe(
      "Command output",
    );
  });

  it("gives row triggers at least a 24px target, larger on compact viewports", () => {
    renderStatefulCard(
      [runningCommand("item_a"), runningCommand("item_b")],
      true,
    );
    expect(rowTrigger("item_a").className).toContain("min-h-6");
    cleanup();

    renderStatefulCard(
      [runningCommand("item_a"), runningCommand("item_b")],
      true,
      true,
    );
    expect(rowTrigger("item_a").className).toContain("min-h-10");
  });

  it("closes a panel with Escape pressed on its row trigger", async () => {
    vi.useFakeTimers();
    backgroundTaskOutput.mockResolvedValue(availableOutput("x"));
    renderStatefulCard(
      [runningCommand("item_a"), runningCommand("item_b")],
      true,
    );
    const trigger = rowTrigger("item_a");
    fireEvent.click(trigger);
    await flushQueries();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(trigger, { key: "Escape" });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("terminal")).toBeNull();
  });

  it("returns focus to the header toggle when Escape closes a single command's panel", async () => {
    vi.useFakeTimers();
    backgroundTaskOutput.mockResolvedValue(availableOutput("x"));
    renderStatefulCard([runningCommand("item_a")]);
    const header = screen.getByRole("button", { expanded: false });
    fireEvent.click(header);
    await flushQueries();
    expect(header.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(screen.getByTestId("terminal"), { key: "Escape" });

    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("terminal")).toBeNull();
    expect(document.activeElement).toBe(header);
  });

  it("closes a single command's panel with Escape pressed on the header toggle", async () => {
    vi.useFakeTimers();
    backgroundTaskOutput.mockResolvedValue(availableOutput("x"));
    renderStatefulCard([runningCommand("item_a")]);
    const header = screen.getByRole("button", { expanded: false });
    fireEvent.click(header);
    await flushQueries();

    fireEvent.keyDown(header, { key: "Escape" });

    expect(header.getAttribute("aria-expanded")).toBe("false");
  });

  describe("a retained finished row", () => {
    async function openThenFinishSecond(compact = false) {
      backgroundTaskOutput.mockResolvedValue(availableOutput("x"));
      const view = renderStatefulCard(
        [runningCommand("item_a"), runningCommand("item_b")],
        true,
        compact,
      );
      fireEvent.click(rowTrigger("item_b"));
      await flushQueries();
      view.update([runningCommand("item_a")]);
      await flushQueries();
      return view;
    }

    it("is not counted as running in the header labels or count badge", async () => {
      vi.useFakeTimers();
      await openThenFinishSecond();

      expect(screen.getAllByText("Finished").length).toBeGreaterThan(0);
      expect(
        screen.getByRole("button", {
          name: "Background commands: Describe item_a",
        }),
      ).not.toBeNull();
      expect(headerCountBadge()).toBe("1");
      expect(
        screen.getByRole("region", { name: "Background commands" }),
      ).not.toBeNull();
    });

    it("is not counted in the compact label", async () => {
      vi.useFakeTimers();
      await openThenFinishSecond(true);

      expect(
        screen.getByRole("button", { name: "Running 1 background command" }),
      ).not.toBeNull();
      expect(
        screen.queryByRole("button", { name: "Running 2 background commands" }),
      ).toBeNull();
    });

    it("counts only live commands in the badge while the others are still running", async () => {
      vi.useFakeTimers();
      backgroundTaskOutput.mockResolvedValue(availableOutput("x"));
      const view = renderStatefulCard(
        [
          runningCommand("item_a"),
          runningCommand("item_b"),
          runningCommand("item_c"),
        ],
        true,
      );
      expect(headerCountBadge()).toBe("3");
      fireEvent.click(rowTrigger("item_c"));
      await flushQueries();

      view.update([runningCommand("item_a"), runningCommand("item_b")]);
      await flushQueries();

      expect(headerCountBadge()).toBe("2");
    });

    it("stays when a new command starts while the card was never expanded", async () => {
      vi.useFakeTimers();
      backgroundTaskOutput.mockImplementation(
        async ({ itemId }: { itemId: string }) =>
          availableOutput(`output of ${itemId}`),
      );
      const view = renderStatefulCard([runningCommand("item_a")]);
      fireEvent.click(screen.getByRole("button", { expanded: false }));
      await flushQueries();
      view.update([]);
      await flushQueries();
      expect(screen.getByTestId("terminal-output").textContent).toBe(
        "output of item_a",
      );

      view.update([runningCommand("item_b")]);
      await flushQueries();
      fireEvent.click(headerToggle());
      await flushQueries();

      expect(rowTrigger("item_a").getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByTestId("terminal-output").textContent).toBe(
        "output of item_a",
      );
      expect(screen.getAllByText("Finished").length).toBeGreaterThan(0);
    });

    it("is dropped, and its panel closed, when the group collapses", async () => {
      vi.useFakeTimers();
      await openThenFinishSecond();
      expect(screen.getByTestId("terminal")).not.toBeNull();

      fireEvent.click(headerToggle());
      await flushQueries();

      expect(screen.queryByTestId("terminal")).toBeNull();
      expect(
        document.getElementById("thread-background-command-trigger-item_b"),
      ).toBeNull();
    });
  });
});

describe("prompt-stack card bodies", () => {
  it("does not mount per-row live durations for a collapsed background-activity card", () => {
    vi.useFakeTimers();
    const setInterval = vi.spyOn(globalThis, "setInterval");
    const startedAt = Date.now() - 5_000;
    function Card() {
      const [isExpanded, setIsExpanded] = useState(false);
      return (
        <ThreadBackgroundCommandsCard
          threadId="thr_test"
          commands={[1, 2, 3].map((index) =>
            workflowRow({
              id: `wf_${index}`,
              description: `Background agent ${index}`,
              model: "haiku",
              startedAt,
              status: "pending",
              taskStatus: "running",
              taskType: "local_agent",
              workflowName: null,
            }),
          )}
          isExpanded={isExpanded}
          onToggle={() => setIsExpanded((value) => !value)}
        />
      );
    }
    render(<Card />);
    expect(screen.queryByText("Background agent 2")).toBeNull();
    expect(setInterval).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("Background agent 2")).not.toBeNull();
    expect(setInterval).toHaveBeenCalledTimes(1);
  });
});
