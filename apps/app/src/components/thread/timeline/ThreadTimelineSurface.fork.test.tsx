// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveThinking } from "@bb/domain";
import { commandRow } from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineSurface } from "./ThreadTimelineSurface";

vi.mock("@/hooks/queries/system-queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/queries/system-queries")>()),
  useSystemConfig: () => ({ data: undefined }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ThreadTimelineSurface ongoing indicator time", () => {
  const commandStartedAt = new Date(2026, 9, 1, 9, 5, 0).getTime();
  const commandCompletedAt = new Date(2026, 9, 1, 9, 17, 0).getTime();
  const thinkingStartedAt = new Date(2026, 9, 1, 9, 21, 0).getTime();

  function renderSurface(activeThinking: ActiveThinking | null) {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ThreadTimelineSurface
            activeThinking={activeThinking}
            contextBoundarySeq={null}
            isThreadTimelinePending={false}
            showOngoingIndicator
            threadId="thread-1"
            threadRuntimeDisplayStatus="active"
            timelineError={false}
            timelineRows={[
              commandRow({
                command: "pnpm test",
                startedAt: commandStartedAt,
                durationMs: commandCompletedAt - commandStartedAt,
              }),
            ]}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("dates Working... from when the last row finished", () => {
    renderSurface(null);

    expect(screen.getByText("09:17").tagName).toBe("TIME");
  });

  it("dates Thinking... from when the reasoning started", () => {
    renderSurface({
      id: "reasoning-1",
      text: "",
      startedAt: thinkingStartedAt,
      updatedAt: thinkingStartedAt + 60_000,
    });

    expect(screen.getByText("09:21").tagName).toBe("TIME");
    expect(screen.queryByText("09:17")).toBeNull();
  });
});
