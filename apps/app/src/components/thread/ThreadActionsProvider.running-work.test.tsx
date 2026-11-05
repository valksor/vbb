// @vitest-environment jsdom

import type { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Thread } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { makeThread as makeThreadFixture } from "@bb/test-helpers/domain-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import { appToast } from "@/components/ui/app-toast";
import { sdk } from "@/lib/sdk";
import { SidebarThreadEntriesProvider } from "@/lib/sidebar-thread-entries";
import {
  ThreadActionsProvider,
  useThreadActions,
} from "./ThreadActionsProvider";

const mocks = vi.hoisted(() => ({
  confirmThreadArchive: true as boolean | undefined,
  closePanesForThreads: vi.fn(),
  deleteThread: vi.fn(),
  mutation: vi.fn(),
  navigate: vi.fn(),
  pathname: "/",
  viewedThreadId: undefined as string | undefined,
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useLocation: () => ({ hash: "", pathname: mocks.pathname, search: "" }),
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("@/components/ui/app-route-anchor", () => ({
  useRouteNavigate: () => mocks.navigate,
}));

vi.mock("jotai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jotai")>();
  return { ...actual, useSetAtom: () => mocks.closePanesForThreads };
});

vi.mock("@/components/dialogs/ThreadDeleteDialog", () => ({
  ThreadDeleteDialog: ({
    target,
    onDelete,
  }: {
    target: { threads: readonly Thread[]; childThreadCount?: number } | null;
    onDelete: (target: unknown) => void;
  }) =>
    target === null ? null : (
      <div role="alertdialog">
        Delete {target.threads.length} with {target.childThreadCount ?? 0}{" "}
        children
        <button type="button" onClick={() => onDelete(target)}>
          Confirm delete
        </button>
      </div>
    ),
}));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: {
    dismiss: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    message: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/hooks/mutations/thread-state-mutations", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/hooks/mutations/thread-state-mutations")
    >();
  return {
    ...actual,
    useDeleteThread: () => ({
      isPending: false,
      mutate: mocks.mutation,
      mutateAsync: mocks.deleteThread,
    }),
    useMarkThreadRead: () => ({ mutate: mocks.mutation }),
    useMarkThreadUnread: () => ({ mutate: mocks.mutation }),
    usePinThread: () => ({ mutate: mocks.mutation }),
    useUnpinThread: () => ({ mutate: mocks.mutation }),
    useUpdateThread: () => ({
      isPending: false,
      mutate: mocks.mutation,
      mutateAsync: mocks.mutation,
    }),
  };
});

vi.mock("@/lib/sdk", () => ({
  sdk: {
    environments: { archiveThreads: vi.fn() },
    threads: {
      archiveAll: vi.fn(),
      childSummary: vi.fn(),
      experimental_listCascade: vi.fn(),
      unarchive: vi.fn(),
    },
  },
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data:
      mocks.confirmThreadArchive === undefined
        ? undefined
        : {
            generalSettings: {
              confirmThreadArchive: mocks.confirmThreadArchive,
            },
          },
  }),
}));

vi.mock("@/hooks/useRouteState", () => ({
  useRouteState: () => ({ threadId: mocks.viewedThreadId }),
}));

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return makeThreadFixture({
    createdAt: 1,
    id: "thr_parent",
    lastReadAt: null,
    latestAttentionAt: 1,
    title: "Investigate archive behavior",
    titleFallback: null,
    updatedAt: 1,
    ...overrides,
  });
}

function ArchiveButton({ thread }: { thread: Thread }) {
  const { requestArchive } = useThreadActions();
  return (
    <button type="button" onClick={() => requestArchive(thread)}>
      Archive
    </button>
  );
}

function SelectionButtons({ threads }: { threads: readonly Thread[] }) {
  const { requestArchiveThreads, requestDeleteThreads } = useThreadActions();
  return (
    <>
      <button type="button" onClick={() => requestArchiveThreads(threads)}>
        Archive selection
      </button>
      <button type="button" onClick={() => requestDeleteThreads(threads)}>
        Delete selection
      </button>
    </>
  );
}

function mockCascade(cascades: Record<string, string[]>) {
  vi.mocked(sdk.threads.experimental_listCascade).mockImplementation(
    async ({ threadIds }) => ({
      threads: threadIds.map((threadId) => ({
        threadId,
        cascadeThreadIds: cascades[threadId] ?? [],
      })),
    }),
  );
}

function ArchiveEnvironmentButton() {
  const { archiveEnvironmentThreads } = useThreadActions();
  return (
    <button onClick={() => void archiveEnvironmentThreads("env_test")}>
      Archive group
    </button>
  );
}

function renderProvider(
  children: ReactNode,
  navigation?: SidebarBootstrapResponse,
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <SidebarThreadEntriesProvider navigation={navigation}>
        <ThreadActionsProvider>{children}</ThreadActionsProvider>
      </SidebarThreadEntriesProvider>
    </QueryClientProvider>,
  );
}

let queryClient: QueryClient;

beforeEach(() => {
  mocks.confirmThreadArchive = true;
  mocks.pathname = "/";
  mocks.viewedThreadId = undefined;
  queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  vi.mocked(sdk.threads.archiveAll).mockResolvedValue({
    archivedThreadIds: ["thr_child", "thr_parent"],
    ok: true,
  });
  mockCascade({ thr_parent: ["thr_child"] });
  vi.mocked(sdk.threads.unarchive).mockResolvedValue({ ok: true });
  mocks.closePanesForThreads.mockReturnValue({
    focusedRoute: null,
    removedAny: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadActionsProvider running work", () => {
  it("opens the archive dialog for a running thread even when confirmation is disabled", async () => {
    mocks.confirmThreadArchive = false;
    mockCascade({});
    renderProvider(<ArchiveButton thread={makeThread({ status: "active" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/This will stop current work\./)).toBeTruthy();
    expect(sdk.threads.archiveAll).not.toHaveBeenCalled();
  });

  it("archives an idle childless thread directly when confirmation is disabled", async () => {
    mocks.confirmThreadArchive = false;
    mockCascade({});
    renderProvider(<ArchiveButton thread={makeThread()} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await vi.waitFor(() =>
      expect(sdk.threads.archiveAll).toHaveBeenCalledWith({
        threadId: "thr_parent",
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the archive dialog when a cascade child is running even when confirmation is disabled", async () => {
    mocks.confirmThreadArchive = false;
    mockCascade({ thr_parent: ["thr_child"] });
    queryClient.setQueryData(
      threadQueryKey("thr_child"),
      makeThread({ id: "thr_child", status: "starting" }),
    );
    renderProvider(<ArchiveButton thread={makeThread()} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/This will stop current work\./)).toBeTruthy();
    expect(sdk.threads.archiveAll).not.toHaveBeenCalled();
  });

  it("opens the archive dialog when one thread of a mixed selection is running", async () => {
    mocks.confirmThreadArchive = false;
    mockCascade({});
    renderProvider(
      <SelectionButtons
        threads={[
          makeThread(),
          makeThread({ id: "thr_other", status: "stopping" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive selection" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Archive 2 threads?" }),
    ).toBeTruthy();
    expect(sdk.threads.archiveAll).not.toHaveBeenCalled();
  });

  it("archives nothing when a running-work confirmation is cancelled", async () => {
    mocks.confirmThreadArchive = false;
    mockCascade({});
    renderProvider(<ArchiveButton thread={makeThread({ status: "active" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sdk.threads.archiveAll).not.toHaveBeenCalled();
  });

  it("confirms an environment archive when one of its threads is running", async () => {
    vi.mocked(sdk.environments.archiveThreads).mockResolvedValue({
      ok: true,
      archivedThreadIds: ["thr_running", "thr_idle_env"],
    });
    renderProvider(
      <ArchiveEnvironmentButton />,
      makeSidebarBootstrapResponse({
        projects: [
          makeProjectWithThreadsResponse({
            threads: [
              makeThreadListEntry(
                makeThread({
                  id: "thr_running",
                  environmentId: "env_test",
                  status: "active",
                }),
              ),
              makeThreadListEntry(
                makeThread({ id: "thr_idle_env", environmentId: "env_test" }),
              ),
            ],
          }),
        ],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive group" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", {
        name: "Archive all threads in this environment?",
      }),
    ).toBeTruthy();
    expect(dialog.textContent).toContain(
      "All threads in this environment stay available and can be unarchived.",
    );
    expect(sdk.environments.archiveThreads).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));
    await vi.waitFor(() =>
      expect(sdk.environments.archiveThreads).toHaveBeenCalledWith({
        environmentId: "env_test",
      }),
    );
    expect(sdk.threads.archiveAll).not.toHaveBeenCalled();
  });

  it("archives an all-idle environment directly without a dialog", async () => {
    vi.mocked(sdk.environments.archiveThreads).mockResolvedValue({
      ok: true,
      archivedThreadIds: ["thr_idle_env"],
    });
    renderProvider(
      <ArchiveEnvironmentButton />,
      makeSidebarBootstrapResponse({
        projects: [
          makeProjectWithThreadsResponse({
            threads: [
              makeThreadListEntry(
                makeThread({ id: "thr_idle_env", environmentId: "env_test" }),
              ),
            ],
          }),
        ],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive group" }));
    await vi.waitFor(() =>
      expect(sdk.environments.archiveThreads).toHaveBeenCalledWith({
        environmentId: "env_test",
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("archives nothing when an environment running-work confirmation is cancelled", async () => {
    renderProvider(
      <ArchiveEnvironmentButton />,
      makeSidebarBootstrapResponse({
        projects: [
          makeProjectWithThreadsResponse({
            threads: [
              makeThreadListEntry(
                makeThread({
                  id: "thr_running",
                  environmentId: "env_test",
                  status: "active",
                }),
              ),
            ],
          }),
        ],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive group" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sdk.environments.archiveThreads).not.toHaveBeenCalled();
  });

  it("closes the dialog with an error toast when a confirmed environment archive fails", async () => {
    vi.mocked(sdk.environments.archiveThreads).mockRejectedValueOnce(
      new Error("Archive failed"),
    );
    renderProvider(
      <ArchiveEnvironmentButton />,
      makeSidebarBootstrapResponse({
        projects: [
          makeProjectWithThreadsResponse({
            threads: [
              makeThreadListEntry(
                makeThread({
                  id: "thr_running",
                  environmentId: "env_test",
                  status: "active",
                }),
              ),
            ],
          }),
        ],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive group" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Archive",
      }),
    );
    await vi.waitFor(() => expect(appToast.error).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(appToast.error).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sdk.environments.archiveThreads).toHaveBeenCalledWith({
      environmentId: "env_test",
    });
  });

  it("shows a neutral toast when a confirmed environment archive leaves nothing archived", async () => {
    vi.mocked(sdk.environments.archiveThreads).mockResolvedValue({
      ok: true,
      archivedThreadIds: [],
    });
    renderProvider(
      <ArchiveEnvironmentButton />,
      makeSidebarBootstrapResponse({
        projects: [
          makeProjectWithThreadsResponse({
            threads: [
              makeThreadListEntry(
                makeThread({
                  id: "thr_running",
                  environmentId: "env_test",
                  status: "active",
                }),
              ),
            ],
          }),
        ],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive group" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Archive",
      }),
    );
    await vi.waitFor(() =>
      expect(appToast.message).toHaveBeenCalledWith(
        "No threads left to archive.",
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(appToast.success).not.toHaveBeenCalled();
  });

  it("stays silent when a direct environment archive leaves nothing archived", async () => {
    vi.mocked(sdk.environments.archiveThreads).mockResolvedValue({
      ok: true,
      archivedThreadIds: [],
    });
    renderProvider(
      <ArchiveEnvironmentButton />,
      makeSidebarBootstrapResponse({
        projects: [
          makeProjectWithThreadsResponse({
            threads: [
              makeThreadListEntry(
                makeThread({ id: "thr_idle_env", environmentId: "env_test" }),
              ),
            ],
          }),
        ],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive group" }));
    await vi.waitFor(() =>
      expect(sdk.environments.archiveThreads).toHaveBeenCalledWith({
        environmentId: "env_test",
      }),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(appToast.message).not.toHaveBeenCalled();
  });

  it("titles a stopped archive toast with the partial-output undo note", async () => {
    mocks.confirmThreadArchive = false;
    mockCascade({});
    renderProvider(<ArchiveButton thread={makeThread({ status: "active" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Archive",
      }),
    );
    await vi.waitFor(() => expect(appToast.success).toHaveBeenCalledTimes(1));
    expect(vi.mocked(appToast.success).mock.calls[0]?.[0]).toBe(
      "Thread stopped and archived",
    );
    const description = vi.mocked(appToast.success).mock.calls[0]?.[1]
      ?.description;
    render(
      <QueryClientProvider client={queryClient}>
        {description}
      </QueryClientProvider>,
    );
    expect(
      screen.getByText("Undo restores it with partial output."),
    ).toBeTruthy();
  });
});
