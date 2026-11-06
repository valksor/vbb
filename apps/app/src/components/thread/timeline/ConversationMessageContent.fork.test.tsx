// @vitest-environment jsdom

import { ThreadTitleMentionResourcesProvider } from "@/components/thread/ThreadTitleMentions";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { LazyMarkdownHtml } from "@/components/ui/lazy-markdown-html";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeThreadListEntry as makeThreadListEntryFixture } from "@bb/test-helpers/domain-fixtures";
import type { ThreadListEntry } from "@bb/domain";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ConversationMessageContent } from "./ConversationMessageContent";

beforeAll(() => LazyMarkdownHtml.preload());

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function threadListEntry(
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return makeThreadListEntryFixture({
    id: "thr_test",
    title: "Thread",
    titleFallback: "Thread",
    lastReadAt: 0,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });
}

describe("ConversationMessageContent ordered lists", () => {
  const listText = "4. a\n1. b";

  it("shows the typed list numbers in a user message", () => {
    const { container } = render(
      <MemoryRouter>
        <RouteNavigationProvider>
          <ConversationMessageContent
            role="user"
            attachments={null}
            initiator="user"
            mentions={[]}
            senderThreadId={null}
            senderThreadTitle={null}
            senderIsPluginSideChat={false}
            systemMessageKind="unlabeled"
            systemMessageSubject={null}
            text={listText}
            timestamp={0}
            turnRequest={{
              isGrouped: false,
              kind: "message",
              status: "accepted",
            }}
          />
        </RouteNavigationProvider>
      </MemoryRouter>,
    );

    expect(
      Array.from(container.querySelectorAll("li")).map((item) =>
        item.getAttribute("value"),
      ),
    ).toEqual(["4", "1"]);
  });

  it("shows the typed list numbers after a thread mention", () => {
    const mentionedThread = threadListEntry({
      id: "thr_dcwivn5n8w",
      projectId: "proj_personal",
      title: "Raw ID mention target",
    });
    const { wrapper } = createQueryClientTestHarness();
    const { container } = render(
      <MemoryRouter>
        <RouteNavigationProvider>
          <ThreadTitleMentionResourcesProvider
            sectionNamesById={new Map()}
            projectNamesById={new Map()}
            threadById={new Map([[mentionedThread.id, mentionedThread]])}
          >
            <ConversationMessageContent
              role="user"
              attachments={null}
              initiator="user"
              mentions={[]}
              senderThreadId={null}
              senderThreadTitle={null}
              senderIsPluginSideChat={false}
              systemMessageKind="unlabeled"
              systemMessageSubject={null}
              text={`See thr_dcwivn5n8w\n\n${listText}`}
              timestamp={0}
              turnRequest={{
                isGrouped: false,
                kind: "message",
                status: "accepted",
              }}
            />
          </ThreadTitleMentionResourcesProvider>
        </RouteNavigationProvider>
      </MemoryRouter>,
      { wrapper },
    );

    expect(
      screen.getByRole("link", { name: "Raw ID mention target" }),
    ).not.toBeNull();
    expect(
      Array.from(container.querySelectorAll("li")).map((item) =>
        item.getAttribute("value"),
      ),
    ).toEqual(["4", "1"]);
  });

  it("keeps CommonMark numbering in an assistant message", () => {
    const { container } = render(
      <MemoryRouter>
        <RouteNavigationProvider>
          <ConversationMessageContent
            role="assistant"
            attachments={null}
            id="msg_list"
            threadId="thr_list"
            turnId="turn_list"
            showActions={false}
            mobileActionDisplay="overflow"
            streaming={false}
            timestamp={0}
            text={listText}
          />
        </RouteNavigationProvider>
      </MemoryRouter>,
    );

    expect(container.querySelector("ol")?.getAttribute("start")).toBe("4");
    expect(container.querySelectorAll("li[value]")).toHaveLength(0);
  });
});
