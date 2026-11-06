// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingInteraction } from "@bb/domain";
import {
  ThreadChildThreadsBanner,
  type ChildThreadQuestion,
  type ThreadPromptChildThreadsSection,
} from "./ThreadPromptContextBanner";

const mocks = vi.hoisted(() => ({
  resolveHook: vi.fn(),
  resolve: vi.fn(async () => ({})),
}));

vi.mock("@/hooks/mutations/thread-interaction-mutations", () => ({
  useResolveThreadPendingInteraction: (threadId: string) => {
    mocks.resolveHook(threadId);
    return { mutateAsync: mocks.resolve, isPending: false, error: null };
  },
  useCancelThreadPendingInteraction: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { interactions: { respond: vi.fn(), cancel: vi.fn() } } },
}));

function childQuestion(
  childThreadId: string,
  prompt: string,
  createdAt: number,
): ChildThreadQuestion {
  const interaction: PendingInteraction = {
    id: `pint_${childThreadId}`,
    threadId: childThreadId,
    turnId: "turn_1",
    providerId: "claude-code",
    providerThreadId: "pt_1",
    providerRequestId: `req_${childThreadId}`,
    status: "pending",
    statusReason: null,
    createdAt,
    resolvedAt: null,
    resolution: null,
    payload: {
      kind: "user_question",
      questions: [
        {
          id: "choice",
          prompt,
          multiSelect: false,
          allowFreeText: false,
          required: true,
          options: [
            { value: "a", label: "Alpha", description: "First choice" },
            { value: "b", label: "Beta", description: "Second choice" },
          ],
        },
      ],
    },
  };
  return {
    childThreadId,
    childTitle: `Child ${childThreadId}`,
    href: `/threads/${childThreadId}`,
    interaction,
  };
}

const newest = childQuestion("thr_b", "Which size?", 3);
const middle = childQuestion("thr_c", "Which shape?", 2);

function section(
  pendingInteractions: readonly ChildThreadQuestion[],
): ThreadPromptChildThreadsSection {
  return {
    items: [
      ...pendingInteractions.map((item) => ({
        id: item.childThreadId,
        title: item.childTitle,
        href: item.href,
        hasPendingInteraction: true,
        pendingInteractionKind: "question" as const,
      })),
      {
        id: "thr_working",
        title: "Investigate failing checks",
        href: "/threads/thr_working",
        hasPendingInteraction: false,
        pendingInteractionKind: null,
      },
    ],
    pendingInteractions,
  };
}

function Harness({
  childThreads,
  initiallyExpanded,
}: {
  childThreads: ThreadPromptChildThreadsSection;
  initiallyExpanded: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
  return (
    <ThreadChildThreadsBanner
      childThreads={childThreads}
      isExpanded={isExpanded}
      onExpandedChange={setIsExpanded}
    />
  );
}

function bannerElement(
  childThreads: ThreadPromptChildThreadsSection,
  initiallyExpanded = true,
  queryClient = new QueryClient(),
) {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Harness
          childThreads={childThreads}
          initiallyExpanded={initiallyExpanded}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  mocks.resolveHook.mockClear();
  mocks.resolve.mockClear();
});

describe("ThreadPromptContextBanner fork coverage", () => {
  it("renders specialized child and shared waiting kinds", () => {
    const planApproval = section([newest]);
    const planApprovalItems = planApproval.items.map((item) =>
      item.hasPendingInteraction
        ? { ...item, pendingInteractionKind: "plan_approval" as const }
        : item,
    );
    const { unmount } = render(
      bannerElement({ ...planApproval, items: planApprovalItems }),
    );

    expect(screen.getAllByLabelText("Thread needs plan approval")).toHaveLength(
      2,
    );
    expect(screen.queryByLabelText("Thread needs user input")).toBe(null);
    fireEvent.click(screen.getByRole("button", { name: /Child thr_b/ }));
    expect(
      screen
        .getByLabelText("Thread needs plan approval")
        .getAttribute("data-icon"),
    ).toBe("FileQuestion");

    unmount();
    const mixed = section([newest, middle]);
    const mixedItems = mixed.items.map((item) =>
      item.id === newest.childThreadId
        ? { ...item, pendingInteractionKind: "plan_approval" as const }
        : item,
    );
    render(bannerElement({ ...mixed, items: mixedItems }));

    expect(
      screen
        .getByLabelText("Thread needs user input")
        .getAttribute("data-icon"),
    ).toBe("CircleQuestion");
  });
});
