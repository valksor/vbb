// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import type { ThreadPendingInteractionKind } from "@bb/domain";
import { afterEach, describe, expect, it } from "vitest";
import {
  ThreadChildThreadsBanner,
  ThreadPromptContextBanner,
  type ThreadPromptArchivedSection,
  type ThreadPromptChildThreadsSection,
  type ThreadPromptEnvironmentGoneSection,
  type ThreadPromptParentThreadSection,
} from "./ThreadPromptContextBanner";
import { removePluginSlotRegistrations } from "@/lib/plugin-slots";
import {
  GIT_SEGMENT_FIXTURE_PLUGIN_ID,
  GitSegmentFixtureProvider,
  type GitSegmentFixture,
} from "@/test/fixtures/git-segment-plugin";

const noop = () => {};
const CHILD_THREADS = "child-threads";

function Banner({
  gitSection,
  gitSectionPending,
  archivedSection,
  environmentGoneSection,
  parentThreadSection,
  childThreadsSection,
  expandedSection,
  onToggleSection,
}: {
  gitSection: GitSegmentFixture | null;
  gitSectionPending: boolean;
  archivedSection: ThreadPromptArchivedSection | null;
  environmentGoneSection: ThreadPromptEnvironmentGoneSection | null;
  parentThreadSection: ThreadPromptParentThreadSection | null;
  childThreadsSection: ThreadPromptChildThreadsSection | null;
  expandedSection: string | null;
  onToggleSection: (key: string) => void;
}) {
  const isReadOnly =
    archivedSection !== null || environmentGoneSection !== null;
  return (
    <GitSegmentFixtureProvider
      value={gitSectionPending ? null : gitSection}
    >
      <ThreadChildThreadsBanner
        childThreads={isReadOnly ? null : childThreadsSection}
        isExpanded={expandedSection === CHILD_THREADS}
        onExpandedChange={() => onToggleSection(CHILD_THREADS)}
      />
      <ThreadPromptContextBanner
        input={{ threadId: "thr_1", projectId: "proj_1", environment: null }}
        core={{ parentThread: parentThreadSection }}
        archivedSection={archivedSection}
        environmentGoneSection={environmentGoneSection}
        expandedSegment={expandedSection}
        onToggleSegment={onToggleSection}
      />
    </GitSegmentFixtureProvider>
  );
}

function renderToMarkup(element: ReactElement): string {
  const { container, unmount } = render(element);
  const markup = container.innerHTML;
  unmount();
  return markup;
}

afterEach(() => {
  cleanup();
  removePluginSlotRegistrations(GIT_SEGMENT_FIXTURE_PLUGIN_ID);
});

function childThreadItem(
  id: string,
  title: string,
  {
    pending = false,
    pendingInteractionKind = null,
  }: {
    pending?: boolean;
    pendingInteractionKind?: ThreadPendingInteractionKind | null;
  } = {},
) {
  return {
    id,
    title,
    href: `/threads/${id}`,
    hasPendingInteraction: pending,
    pendingInteractionKind,
  };
}

describe("ThreadPromptContextBanner", () => {
  it.each(["destroyed", "removed", "removing", "cleanup-failed"] as const)(
    "offers continuing in a new thread for a %s environment only when the handler is set",
    (status) => {
      const withHandler = renderToMarkup(
        <Banner
          gitSection={null}
          gitSectionPending={false}
          archivedSection={null}
          environmentGoneSection={{ status, onContinueInNewThread: noop }}
          parentThreadSection={null}
          childThreadsSection={null}
          expandedSection={null}
          onToggleSection={noop}
        />,
      );
      const withoutHandler = renderToMarkup(
        <Banner
          gitSection={null}
          gitSectionPending={false}
          archivedSection={null}
          environmentGoneSection={{ status }}
          parentThreadSection={null}
          childThreadsSection={null}
          expandedSection={null}
          onToggleSection={noop}
        />,
      );

      expect(withHandler).toContain(">Continue in new thread<");
      expect(withoutHandler).not.toContain("Continue in new thread");
    },
  );

  it("lists restore before continue and keeps continue enabled while restore is pending", () => {
    const markup = renderToMarkup(
      <Banner
        gitSection={null}
        gitSectionPending={false}
        archivedSection={null}
        environmentGoneSection={{
          status: "destroyed",
          onRestore: noop,
          restorePending: true,
          onContinueInNewThread: noop,
        }}
        parentThreadSection={null}
        childThreadsSection={null}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup.indexOf(">Restore workspace<")).toBeLessThan(
      markup.indexOf(">Continue in new thread<"),
    );
    expect(
      markup.match(/<button([^>]*)>Continue in new thread<\/button>/)?.[1],
    ).not.toContain('disabled=""');
  });

  it("offers continuing in a new thread on an archived thread whose environment is gone", () => {
    const markup = renderToMarkup(
      <Banner
        gitSection={null}
        gitSectionPending={false}
        archivedSection={{ archivedAt: 1_731_456_000_000, onUnarchive: noop }}
        environmentGoneSection={{
          status: "destroyed",
          onRestore: noop,
          onContinueInNewThread: noop,
        }}
        parentThreadSection={null}
        childThreadsSection={null}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain(">Unarchive<");
    expect(markup).toContain(">Continue in new thread<");
    expect(markup).not.toContain("Restore workspace");
  });

  it("keeps continue visible beside the parent-thread segment when the environment is gone", () => {
    const markup = renderToMarkup(
      <MemoryRouter>
        <Banner
          gitSection={null}
          gitSectionPending={false}
          archivedSection={null}
          environmentGoneSection={{
            status: "destroyed",
            onContinueInNewThread: noop,
          }}
          parentThreadSection={{
            parentThreadTitle: "Parent thread",
            href: "/threads/thr_parent",
            relationship: "parent",
          }}
          childThreadsSection={null}
          expandedSection={null}
          onToggleSection={noop}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain(">Continue in new thread<");
  });

  it("shows each waiting child's kind as its row glyph and label", () => {
    const markup = renderToMarkup(
      <MemoryRouter>
        <Banner
          gitSection={null}
          gitSectionPending={false}
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={null}
          childThreadsSection={{
            items: [
              childThreadItem("thr_plan", "Prepare the rollout plan", {
                pending: true,
                pendingInteractionKind: "plan_approval",
              }),
              childThreadItem("thr_question", "Pick a shape", {
                pending: true,
                pendingInteractionKind: "question",
              }),
              childThreadItem("thr_approval", "Run the migration", {
                pending: true,
                pendingInteractionKind: "approval",
              }),
            ],
            pendingInteractions: [],
          }}
          expandedSection={CHILD_THREADS}
          onToggleSection={noop}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain('data-icon="FileQuestion"');
    expect(markup).toContain('aria-label="Thread needs plan approval"');
    expect(markup).toContain('data-icon="MessageQuestion"');
    expect(markup).toContain('aria-label="Thread is waiting for your answer"');
    expect(markup).toContain('data-icon="CircleQuestion"');
    expect(markup).toContain('aria-label="Thread needs user input"');
  });

  it("shows the plan glyph on the header badge when every waiting child needs plan approval", () => {
    const markup = renderToMarkup(
      <MemoryRouter>
        <Banner
          gitSection={null}
          gitSectionPending={false}
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={null}
          childThreadsSection={{
            items: [
              childThreadItem("thr_plan_a", "Prepare the rollout plan", {
                pending: true,
                pendingInteractionKind: "plan_approval",
              }),
              childThreadItem("thr_plan_b", "Draft the migration plan", {
                pending: true,
                pendingInteractionKind: "plan_approval",
              }),
            ],
            pendingInteractions: [],
          }}
          expandedSection={null}
          onToggleSection={noop}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain('data-icon="FileQuestion"');
    expect(markup).toContain('aria-label="Thread needs plan approval"');
    expect(markup).not.toContain('data-icon="CircleQuestion"');
  });

  it("falls back to the generic glyph when waiting children disagree", () => {
    const markup = renderToMarkup(
      <MemoryRouter>
        <Banner
          gitSection={null}
          gitSectionPending={false}
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={null}
          childThreadsSection={{
            items: [
              childThreadItem("thr_question", "Pick a shape", {
                pending: true,
                pendingInteractionKind: "question",
              }),
              childThreadItem("thr_plan", "Prepare the rollout plan", {
                pending: true,
                pendingInteractionKind: "plan_approval",
              }),
            ],
            pendingInteractions: [],
          }}
          expandedSection={null}
          onToggleSection={noop}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain('data-icon="CircleQuestion"');
    expect(markup).toContain('aria-label="Thread needs user input"');
    expect(markup).not.toContain('data-icon="FileQuestion"');
    expect(markup).not.toContain('data-icon="MessageQuestion"');
  });
});
