// @vitest-environment jsdom

import { LazyMarkdownHtml } from "@/components/ui/lazy-markdown-html";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { ConversationMessageContent } from "./ConversationMessageContent";
import { ThreadTimelineNavigationProvider } from "./ThreadTimelineNavigationContext";
import { ShellCommandRunnerSourceProvider } from "@/components/ui/markdown-shell-command-run.fork";
import { USER_MESSAGE_CHAR_CAP } from "@bb/client-core";

beforeAll(() => LazyMarkdownHtml.preload());

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const BASH_BLOCK = "```bash\nnpm run build\n```";

function renderAssistantMessage(args: {
  streaming: boolean;
  shellCommandRunner?: ((code: string, language: string) => void) | null;
  text: string;
  workspaceRootPath?: string;
}) {
  return render(
    <MemoryRouter>
      <RouteNavigationProvider>
        <ThreadTimelineNavigationProvider
          environmentId={null}
          hostId={null}
          onOpenLocalFileLink={() => false}
          resolveMentionLink={() => null}
          workspaceRootPath={args.workspaceRootPath}
        >
          <ShellCommandRunnerSourceProvider
            runner={args.shellCommandRunner ?? null}
          >
            <ConversationMessageContent
              role="assistant"
              attachments={null}
              id="msg_run"
              threadId="thr_run"
              turnId="turn_run"
              showActions={false}
              mobileActionDisplay="overflow"
              streaming={args.streaming}
              text={args.text}
              timestamp={0}
            />
          </ShellCommandRunnerSourceProvider>
        </ThreadTimelineNavigationProvider>
      </RouteNavigationProvider>
    </MemoryRouter>,
  );
}

function renderUserMessage(args: {
  shellCommandRunner?: ((code: string, language: string) => void) | null;
  text: string;
  workspaceRootPath?: string;
}) {
  return render(
    <MemoryRouter>
      <RouteNavigationProvider>
        <ThreadTimelineNavigationProvider
          environmentId={null}
          hostId={null}
          onOpenLocalFileLink={() => false}
          resolveMentionLink={() => null}
          workspaceRootPath={args.workspaceRootPath}
        >
          <ShellCommandRunnerSourceProvider
            runner={args.shellCommandRunner ?? null}
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
              text={args.text}
              timestamp={0}
              turnRequest={{
                isGrouped: false,
                kind: "message",
                status: "accepted",
              }}
            />
          </ShellCommandRunnerSourceProvider>
        </ThreadTimelineNavigationProvider>
      </RouteNavigationProvider>
    </MemoryRouter>,
  );
}

function queryRunButton() {
  return screen.queryByRole("button", { name: /^Run in terminal/u });
}

describe("ConversationMessageContent shell command run visibility", () => {
  it("shows the run button on a settled assistant message", () => {
    renderAssistantMessage({
      streaming: false,
      shellCommandRunner: vi.fn(),
      text: `Setup:\n\n${BASH_BLOCK}`,
      workspaceRootPath: "/workspace",
    });

    expect(screen.getByRole("button", { name: "Run in terminal (bash)" }));
  });

  it("hides the run button while the assistant message streams", () => {
    renderAssistantMessage({
      streaming: true,
      shellCommandRunner: vi.fn(),
      text: BASH_BLOCK,
      workspaceRootPath: "/workspace",
    });

    expect(queryRunButton()).toBeNull();
  });

  it("hides the run button when the workspace root path is missing", () => {
    renderAssistantMessage({
      streaming: false,
      shellCommandRunner: vi.fn(),
      text: BASH_BLOCK,
    });

    expect(queryRunButton()).toBeNull();
  });

  it("hides the run button when the runner is null", () => {
    renderAssistantMessage({
      streaming: false,
      shellCommandRunner: null,
      text: BASH_BLOCK,
      workspaceRootPath: "/workspace",
    });

    expect(queryRunButton()).toBeNull();
  });

  it("shows the run button on a user message", () => {
    renderUserMessage({
      shellCommandRunner: vi.fn(),
      text: `Please run:\n\n${BASH_BLOCK}`,
      workspaceRootPath: "/workspace",
    });

    expect(screen.getByRole("button", { name: "Run in terminal (bash)" }));
  });

  it("hides the run button on a capped user-message preview until expanded", () => {
    const text = `${"a".repeat(USER_MESSAGE_CHAR_CAP)}\n\n${BASH_BLOCK}`;
    renderUserMessage({
      shellCommandRunner: vi.fn(),
      text,
      workspaceRootPath: "/workspace",
    });

    expect(queryRunButton()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));

    expect(screen.getByRole("button", { name: "Run in terminal (bash)" }));
  });
});
