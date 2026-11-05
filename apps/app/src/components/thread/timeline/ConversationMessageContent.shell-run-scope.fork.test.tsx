// @vitest-environment jsdom

import type { ReactElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { USER_MESSAGE_CHAR_CAP } from "@bb/client-core";
import type {
  ExperimentalCodeFenceRendererProps,
  PluginMessageDirectiveProps,
} from "@get-bb/plugin-sdk";
import { LazyPluginThreadChat } from "@/components/plugin/LazyPluginThreadChat";
import { LazyPluginMarkdown } from "@/components/plugin/lazy-plugin-renderers";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { LazyMarkdownHtml } from "@/components/ui/lazy-markdown-html";
import {
  buildCodeFenceRendererRegistry,
  CodeFenceRendererRegistryProvider,
} from "@/components/ui/markdown-code-fence-renderers";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import {
  buildMessageDirectiveRegistry,
  MessageDirectiveRegistryProvider,
} from "@/components/ui/markdown-message-directives";
import { ShellCommandRunnerSourceProvider } from "@/components/ui/markdown-shell-command-run.fork";
import { sdk } from "@/lib/sdk";
import { pluginSdkAppImplementation } from "@/lib/plugin-sdk-app-impl";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ConversationMessageContent } from "./ConversationMessageContent";
import { DelegationOutputMessageContent } from "./DelegationOutputMessageContent.fork";
import { GeneratedConversationMessage } from "./GeneratedConversationMessage";
import { ThreadTimelineNavigationProvider } from "./ThreadTimelineNavigationContext";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    threads: { get: vi.fn() },
    environments: { get: vi.fn() },
    providers: { list: vi.fn(async () => []) },
  },
  BbHttpError: class BbHttpError extends Error {
    status: number;
    constructor(status: number) {
      super(`http ${status}`);
      this.status = status;
    }
  },
}));

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useHostListRealtimeSubscription: vi.fn(),
  useThreadDetailRealtimeSubscription: vi.fn(),
  useThreadTimelineRealtimeSubscription: vi.fn(),
  useThreadListRealtimeSubscription: vi.fn(),
  useEnvironmentDetailRealtimeSubscription: vi.fn(),
  useSystemRealtimeSubscription: vi.fn(),
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({ isLocalDaemonHost: () => true }),
}));

vi.mock("@/components/thread/timeline", () => ({
  useThreadTimelineController: () => ({ timelineRows: [] }),
}));

vi.mock("@/views/thread-detail/ThreadScreen", async () => {
  const { ConversationMessageContent: Message } =
    await import("./ConversationMessageContent");
  return {
    ThreadScreen: () => (
      <Message
        role="assistant"
        attachments={null}
        id="msg_nested"
        threadId="thr_nested"
        turnId="turn_nested"
        showActions={false}
        mobileActionDisplay="overflow"
        streaming={false}
        text={BASH_BLOCK}
        timestamp={0}
      />
    ),
  };
});

beforeAll(async () => {
  await Promise.all([
    LazyMarkdownHtml.preload(),
    LazyPluginMarkdown.preload(),
    LazyPluginThreadChat.preload(),
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const BASH_BLOCK = "```bash\nnpm run build\n```";
const RUN_BUTTON_NAME = "Run in terminal (bash)";

function PluginMarkdownProbe() {
  const Markdown = pluginSdkAppImplementation.Markdown;
  return <Markdown content={BASH_BLOCK} />;
}

function CodeFenceProbe(_props: ExperimentalCodeFenceRendererProps) {
  return <PluginMarkdownProbe />;
}

function OriginalFenceProbe({ Original }: ExperimentalCodeFenceRendererProps) {
  return <Original />;
}

const SDK_SHELL_BLOCK = "```sh\necho sdk\n```";

function OriginalAndSdkMarkdownProbe({
  Original,
}: ExperimentalCodeFenceRendererProps) {
  const Markdown = pluginSdkAppImplementation.Markdown;
  return (
    <>
      <div data-testid="original-block">
        <Original />
      </div>
      <div data-testid="sdk-markdown-block">
        <Markdown content={SDK_SHELL_BLOCK} />
      </div>
    </>
  );
}

function DirectiveProbe(_props: PluginMessageDirectiveProps) {
  return <PluginMarkdownProbe />;
}

const CODE_FENCE_REGISTRY = buildCodeFenceRendererRegistry([
  {
    id: "probe-fence",
    pluginId: "demo",
    generation: 1,
    languages: ["probefence"],
    component: CodeFenceProbe,
  },
]);

const ORIGINAL_FENCE_REGISTRY = buildCodeFenceRendererRegistry([
  {
    id: "original-fence",
    pluginId: "demo",
    generation: 1,
    languages: ["bash"],
    component: OriginalFenceProbe,
  },
]);

const ORIGINAL_AND_SDK_FENCE_REGISTRY = buildCodeFenceRendererRegistry([
  {
    id: "original-and-sdk-fence",
    pluginId: "demo",
    generation: 1,
    languages: ["bash"],
    component: OriginalAndSdkMarkdownProbe,
  },
]);

const DIRECTIVE_REGISTRY = buildMessageDirectiveRegistry([
  {
    id: "probe-directive",
    pluginId: "demo",
    generation: 1,
    component: DirectiveProbe,
  },
]);

function threadPage(runner: () => void, children: ReactElement) {
  return (
    <MemoryRouter>
      <RouteNavigationProvider>
        <ThreadTimelineNavigationProvider
          environmentId={null}
          hostId={null}
          onOpenLocalFileLink={() => false}
          resolveMentionLink={() => null}
          workspaceRootPath="/workspace"
        >
          <ShellCommandRunnerSourceProvider runner={runner}>
            {children}
          </ShellCommandRunnerSourceProvider>
        </ThreadTimelineNavigationProvider>
      </RouteNavigationProvider>
    </MemoryRouter>
  );
}

function userMessage(args: {
  initiator: "user" | "agent" | "system";
  senderIsPluginSideChat?: boolean;
  senderThreadId?: string | null;
  text: string;
}) {
  return (
    <ConversationMessageContent
      role="user"
      attachments={null}
      initiator={args.initiator}
      mentions={[]}
      senderThreadId={args.senderThreadId ?? null}
      senderThreadTitle={args.senderThreadId === undefined ? null : "Sender"}
      senderIsPluginSideChat={args.senderIsPluginSideChat ?? false}
      systemMessageKind="unlabeled"
      systemMessageSubject={null}
      text={args.text}
      timestamp={0}
      turnRequest={{ isGrouped: false, kind: "message", status: "accepted" }}
    />
  );
}

function assistantMessage(args: {
  streaming?: boolean;
  text?: string;
  Message?: typeof ConversationMessageContent;
}) {
  const Message = args.Message ?? ConversationMessageContent;
  return (
    <Message
      role="assistant"
      attachments={null}
      id="msg_scope"
      threadId="thr_scope"
      turnId="turn_scope"
      showActions={false}
      mobileActionDisplay="overflow"
      streaming={args.streaming ?? false}
      text={args.text ?? BASH_BLOCK}
      timestamp={0}
    />
  );
}

function recipientMessage() {
  return (
    <GeneratedConversationMessage
      attachmentItems={{ filePaths: [], fileDetails: [], imageItems: [] }}
      automationLink={null}
      mentions={[]}
      sourceIsPluginSideChat={false}
      sourceKind="agent-recipient"
      sourceName="Recipient"
      sourceProjectId={null}
      sourceThreadId="thr_recipient"
      systemMessageKind="unlabeled"
      systemMessageSubject={null}
      text={BASH_BLOCK}
      timestamp={0}
      turnRequest={{ isGrouped: false, kind: "message", status: "accepted" }}
    />
  );
}

function nestedThreadChat() {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  const ThreadChat = pluginSdkAppImplementation.ThreadChat;
  return (
    <Wrapper>
      <ThreadChat threadId="thr_demo" variant="compact" />
    </Wrapper>
  );
}

interface ScopeRow {
  name: string;
  node: () => ReactElement;
  ready?: "expand-generated" | "capped-preview";
  registries?:
    | "code-fence"
    | "original-fence"
    | "original-and-sdk-fence"
    | "directive";
  runButton: boolean;
  runButtonScope?: "original-only";
}

const ROWS: readonly ScopeRow[] = [
  {
    name: "user body (uncapped)",
    node: () => userMessage({ initiator: "user", text: BASH_BLOCK }),
    runButton: true,
  },
  {
    name: "user body (capped)",
    node: () =>
      userMessage({
        initiator: "user",
        text: `${"a".repeat(USER_MESSAGE_CHAR_CAP)}\n\n${BASH_BLOCK}`,
      }),
    ready: "capped-preview",
    runButton: false,
  },
  {
    name: "assistant settled body",
    node: () => assistantMessage({}),
    runButton: true,
  },
  {
    name: "assistant streaming body",
    node: () => assistantMessage({ streaming: true }),
    runButton: false,
  },
  {
    name: "delegation output",
    node: () => assistantMessage({ Message: DelegationOutputMessageContent }),
    runButton: false,
  },
  {
    name: "generated message: agent",
    node: () =>
      userMessage({
        initiator: "agent",
        senderThreadId: "thr_sender",
        text: BASH_BLOCK,
      }),
    ready: "expand-generated",
    runButton: false,
  },
  {
    name: "generated message: agent-recipient",
    node: recipientMessage,
    ready: "expand-generated",
    runButton: false,
  },
  {
    name: "generated message: plugin side chat",
    node: () =>
      userMessage({
        initiator: "agent",
        senderIsPluginSideChat: true,
        senderThreadId: "thr_sender",
        text: BASH_BLOCK,
      }),
    ready: "expand-generated",
    runButton: false,
  },
  {
    name: "generated message: automation",
    node: () =>
      userMessage({
        initiator: "user",
        text: `[bb automation due:auto_1] ${BASH_BLOCK}`,
      }),
    ready: "expand-generated",
    runButton: false,
  },
  {
    name: "generated message: system",
    node: () => userMessage({ initiator: "system", text: BASH_BLOCK }),
    ready: "expand-generated",
    runButton: false,
  },
  {
    name: "plugin SDK Markdown from a code-fence renderer",
    node: () =>
      assistantMessage({ text: "```probefence\nx\n```\n\nSettled body." }),
    registries: "code-fence",
    runButton: false,
  },
  {
    name: "BB original code block through Original: settled assistant body",
    node: () => assistantMessage({}),
    registries: "original-fence",
    runButton: true,
  },
  {
    name: "BB original code block through Original: streaming assistant body",
    node: () => assistantMessage({ streaming: true }),
    registries: "original-fence",
    runButton: false,
  },
  {
    name: "BB original code block with a renderer registered: uncapped user body",
    node: () => userMessage({ initiator: "user", text: BASH_BLOCK }),
    registries: "original-fence",
    runButton: true,
  },
  {
    name: "BB original code block with a renderer registered: capped user body",
    node: () =>
      userMessage({
        initiator: "user",
        text: `${"a".repeat(USER_MESSAGE_CHAR_CAP)}\n\n${BASH_BLOCK}`,
      }),
    ready: "capped-preview",
    registries: "original-fence",
    runButton: false,
  },
  {
    name: "BB original code block with a renderer registered: generated message",
    node: () =>
      userMessage({
        initiator: "agent",
        senderThreadId: "thr_sender",
        text: BASH_BLOCK,
      }),
    ready: "expand-generated",
    registries: "original-fence",
    runButton: false,
  },
  {
    name: "Original and plugin SDK Markdown from one renderer: settled assistant body",
    node: () => assistantMessage({ text: `Intro\n\n${BASH_BLOCK}` }),
    registries: "original-and-sdk-fence",
    runButton: true,
    runButtonScope: "original-only",
  },
  {
    name: "plugin SDK Markdown from a message directive",
    node: () =>
      assistantMessage({ text: "::probe-directive\n\nSettled body." }),
    registries: "directive",
    runButton: false,
  },
  {
    name: "nested plugin ThreadChat screen",
    node: nestedThreadChat,
    runButton: false,
  },
];

function renderRow(row: ScopeRow) {
  const node = row.node();
  const withRegistry =
    row.registries === "code-fence" ? (
      <CodeFenceRendererRegistryProvider registry={CODE_FENCE_REGISTRY}>
        {node}
      </CodeFenceRendererRegistryProvider>
    ) : row.registries === "original-fence" ? (
      <CodeFenceRendererRegistryProvider registry={ORIGINAL_FENCE_REGISTRY}>
        {node}
      </CodeFenceRendererRegistryProvider>
    ) : row.registries === "original-and-sdk-fence" ? (
      <CodeFenceRendererRegistryProvider
        registry={ORIGINAL_AND_SDK_FENCE_REGISTRY}
      >
        {node}
      </CodeFenceRendererRegistryProvider>
    ) : row.registries === "directive" ? (
      <MessageDirectiveRegistryProvider registry={DIRECTIVE_REGISTRY}>
        {node}
      </MessageDirectiveRegistryProvider>
    ) : (
      node
    );
  return render(threadPage(vi.fn(), withRegistry));
}

function queryRunButtons() {
  return screen.queryAllByRole("button", { name: /^Run in terminal/u });
}

describe("shell command runner scope under a thread screen", () => {
  it.each(ROWS)("$name", async (row) => {
    vi.mocked(sdk.threads.get).mockResolvedValue({
      id: "thr_demo",
      projectId: "proj_demo",
      providerId: "provider_demo",
      environmentId: null,
      status: "active",
      runtime: { displayStatus: "idle" },
    } as never);
    const view = renderRow(row);

    if (row.ready === "capped-preview") {
      await screen.findByRole("button", { name: "Show more" });
    } else {
      if (row.ready === "expand-generated") {
        const toggle = await waitFor(() => {
          const found = view.container.querySelector(
            'button[aria-expanded="false"]',
          );
          expect(found).not.toBeNull();
          return found!;
        });
        fireEvent.click(toggle);
      }
      await waitFor(() => {
        expect(view.container.textContent).toContain("npm run build");
      });
      if (row.runButtonScope === "original-only") {
        await waitFor(() => {
          expect(view.container.textContent).toContain("echo sdk");
        });
      }
    }

    if (row.runButtonScope === "original-only") {
      const original = screen.getByTestId("original-block");
      const sdkMarkdown = screen.getByTestId("sdk-markdown-block");
      expect(
        within(original).getAllByRole("button", { name: RUN_BUTTON_NAME }),
      ).toHaveLength(1);
      expect(
        within(sdkMarkdown).queryAllByRole("button", {
          name: /^Run in terminal/u,
        }),
      ).toHaveLength(0);
      expect(queryRunButtons()).toHaveLength(1);
    } else if (row.runButton) {
      expect(
        screen.getAllByRole("button", { name: RUN_BUTTON_NAME }),
      ).toHaveLength(1);
    } else {
      expect(queryRunButtons()).toHaveLength(0);
    }
  });

  it("hides the run button in markdown outside conversation messages", () => {
    render(threadPage(vi.fn(), <MarkdownPreview content={BASH_BLOCK} />));

    expect(queryRunButtons()).toHaveLength(0);
  });
});
