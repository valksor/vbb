// @vitest-environment jsdom

import { useEffect, useState, type ReactNode } from "react";
import { Provider } from "jotai";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defaultAppSettings } from "@bb/domain";
import { act, cleanup, render as renderWithoutQueryClient, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalComposerSelection, PluginEnvironmentProviderInputsProps } from "@get-bb/plugin-sdk";
import type { SystemEnvironmentProvider, SystemMachineProvider } from "@bb/server-contract";
import { NewThreadComposer, type NewThreadComposerProps } from "@/components/promptbox/NewThreadComposer";
import { setComposerSelectionSettleTimeoutForTest } from "@/components/promptbox/composer-selection-settle";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import { resetPluginSlotStoreForTest, setPluginSlotRegistrations } from "@/lib/plugin-slots";
import { getPromptDraftAccessor, type PromptDraftScope } from "@/hooks/usePromptDraftStorage";
import type { PromptDraftState } from "@bb/client-core";
import { makeProjectWithThreadsResponse } from "@/test/fixtures/projects";

function render(element: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithoutQueryClient(element, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

const mocks = vi.hoisted(() => ({
  promptBoxProps: [] as Array<Record<string, any>>,
  copyAttachments: vi.fn(),
  uploadAttachment: vi.fn(),
  environmentProviders: [] as unknown[],
  machineProviders: [] as SystemMachineProvider[],
}));

vi.mock("@/components/promptbox/NewThreadPromptBox", () => ({
  NewThreadPromptBox: (props: Record<string, any>) => {
    mocks.promptBoxProps.push(props);
    return (
      <div data-testid="new-thread-prompt-box">
        {props.modeConfig?.environmentProviderInputsSlot ?? null}
      </div>
    );
  },
}));

vi.mock("@/hooks/queries/environment-provider-queries", () => ({
  useSystemEnvironmentProviders: () => ({
    providers: mocks.environmentProviders,
  }),
}));

vi.mock("@/hooks/queries/machine-provider-queries", () => ({
  useSystemMachineProviders: () => ({ providers: mocks.machineProviders }),
}));

vi.mock("@/hooks/queries/plugin-settings-queries", () => ({
  usePluginList: () => ({ data: { plugins: [] } }),
}));

vi.mock("@/lib/sdk", () => ({
  sdk: {
    projects: { attachments: { copy: mocks.copyAttachments } },
    system: {
      experimental_recordTelemetryEvent: vi
        .fn()
        .mockRejectedValue(new Error("Telemetry unavailable")),
    },
  },
}));

const PROJECT = makeProjectWithThreadsResponse({
  id: "proj_1",
  name: "Project One",
  defaultExecutionOptions: {
    providerId: "codex",
    model: "gpt-5.6",
    serviceTier: "default",
    reasoningLevel: "medium",
    permissionMode: "auto",
  },
  sources: [
    {
      id: "src_1",
      projectId: "proj_1",
      type: "local_path",
      hostId: "host_1",
      path: "/repo",
      isDefault: true,
      createdAt: 0,
      updatedAt: 0,
    },
  ],
});

const OTHER_PROJECT = makeProjectWithThreadsResponse({
  ...PROJECT,
  id: "proj_2",
  name: "Project Two",
  sources: [{ ...PROJECT.sources[0], id: "src_2", projectId: "proj_2" }],
});

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    data: {
      sections: [],
      projects: [PROJECT, OTHER_PROJECT],
      personalProject: makeProjectWithThreadsResponse({
        id: "personal",
        kind: "personal",
        name: "Personal",
        sources: [],
        threads: [],
      }),
    },
    isError: false,
    isLoading: false,
    isPending: false,
    isSuccess: true,
    isPlaceholderData: false,
  }),
}));

vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: () => ({ data: [{ id: "host_1", name: "Machine" }] }),
  selectHosts: <T,>(hosts: T[] | undefined) => hosts ?? [],
  selectPrimaryHost: (
    hosts: Array<{ id: string }> | undefined,
    primaryHostId: string | null,
  ) => hosts?.find((host) => host.id === primaryHostId) ?? hosts?.[0] ?? null,
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemProviders: () => ({ data: undefined }),
  useSystemProviderStates: () => ({ data: undefined, isPending: false }),
  useKnownProviderModelCatalogScope: () => undefined,
  useHostProviderCliStatus: () => ({ data: undefined }),
  useSystemConfig: () => ({
    data: {
      primaryHostId: "host_1",
      generalSettings: defaultAppSettings,
      serverAccess: {
        providers: [],
        defaultProviderId: null,
        effectiveUrl: null,
        urlSource: null,
      },
    },
  }),
  useSystemExecutionOptions: () => ({
    data: {
      permissionCeiling: undefined,
      providers: [
        {
          id: "codex",
          displayName: "Codex",
          logoUrl: null,
          capabilities: {
            supportsServiceTier: false,
            permissionModes: ["auto", "accept-edits", "full"],
          },
          composerActions: [],
        },
      ],
      models: [
        {
          model: "gpt-5.6",
          displayName: "GPT-5.6",
          isDefault: true,
          sessionOptions: undefined,
          reasoningDiscovery: "known" as const,
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
            { reasoningEffort: "high" },
          ],
        },
      ],
      selectedOnlyModels: [],
      modelLoadError: null,
    },
    isLoading: false,
    isError: false,
    isPlaceholderData: false,
  }),
}));

vi.mock("@/hooks/queries/thread-panel-queries", () => ({
  useThreadStorageFiles: () => ({
    data: undefined,
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useThreadStorageFilePreview: () => ({
    data: undefined,
    error: null,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/queries/project-queries", () => ({
  stripProjectThreads: (project: unknown) => project,
  useProjectPromptHistory: () => ({ data: [] }),
  useProjectSourceBranches: () => ({
    data: {
      branches: ["main"],
      branchesTruncated: false,
      checkout: { kind: "branch", branchName: "main" },
      defaultBranch: "main",
      defaultBranchRelation: null,
      hasUncommittedChanges: false,
      operation: { kind: "none" },
      originDefaultBranch: null,
      remoteBranches: [],
      remoteBranchesTruncated: false,
      selectedBranch: null,
      defaultWorktreeBaseBranch: null,
    },
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/queries/project-default-execution-options-query", () => ({
  useProjectDefaultExecutionOptions: () => ({ data: undefined }),
}));

vi.mock("@/hooks/mutations/project-mutations", () => ({
  useUploadPromptAttachment: () => ({
    mutateAsync: mocks.uploadAttachment,
    isPending: false,
  }),
}));

vi.mock("@/hooks/usePromptMentions", async () =>
  (await import("@/test/fixtures/composer-search")).fakePromptMentionsModule(),
);

vi.mock("@/hooks/useCommandSuggestions", async () =>
  (
    await import("@/test/fixtures/composer-search")
  ).fakeCommandSuggestionsModule(),
);

vi.mock("@/hooks/useQuickCreateProject", () => ({
  useQuickCreateProjectController: () => ({
    hostId: null,
    hostName: null,
    hosts: [],
    isAvailable: false,
    isCreating: false,
    openCreateDialog: vi.fn(),
    platform: null,
    projectPathDialog: {
      isOpen: false,
      onOpenChange: vi.fn(),
      target: null,
    },
    submitProjectPath: vi.fn(),
  }),
}));

vi.mock("@/components/dialogs/ProjectMachineSetupDialog", () => ({
  ProjectMachineSetupDialog: () => null,
}));

const CHECKOUT_PROVIDER: SystemEnvironmentProvider = {
  machineProviderId: null,
  id: "project-checkout",
  displayName: "Project checkout",
  description: "Prepare a workspace for this thread.",
  icon: "Laptop",
  logoUrl: null,
  pluginId: "environment-project-checkout",
  acceptsEmptyInputs: true,
  machineAvailability: {},
  availability: null,
  requires: {
    projectCheckout: true,
    gitCheckout: false,
    gitRemote: false,
    projectless: false,
  },
  inputs: {
    type: "object",
    properties: { branch: { type: "object" }, path: { type: "string" } },
  },
};

const EMPTY_SLOT_REGISTRATIONS = {
  homepageSections: [],
  settingsSections: [],
  navPanels: [],
  threadPanelActions: [],
  sidebarFooterActions: [],
  fileOpeners: [],
  messageDirectives: [],
};

function CheckoutInputsControl({
  value,
  onChange,
}: PluginEnvironmentProviderInputsProps) {
  useEffect(() => {
    if (value === null) onChange({ status: "ready", value: {} });
  }, [onChange, value]);
  return null;
}

function registerCheckoutInputsControl(): void {
  setPluginSlotRegistrations("environment-project-checkout", {
    ...EMPTY_SLOT_REGISTRATIONS,
    environmentProviderInputs: [
      {
        environmentProviderId: "project-checkout",
        component: CheckoutInputsControl,
      },
    ],
  });
}

function latestPromptBoxProps(): Record<string, any> {
  const props = mocks.promptBoxProps.at(-1);
  expect(props).toBeDefined();
  return props as Record<string, any>;
}

function RootLikeComposer({
  initialProjectId,
  draftStorage,
  carryDraftToProject,
}: {
  initialProjectId: string;
  draftStorage?: PromptDraftScope;
  carryDraftToProject?: NewThreadComposerProps["carryDraftToProject"];
}) {
  const [projectId, setProjectId] = useState(initialProjectId);
  return (
    <NewThreadComposer
      projectId={projectId}
      onProjectChange={setProjectId}
      draftStorage={draftStorage ?? { kind: "new-thread", projectId }}
      carryDraftToProject={carryDraftToProject}
      selectionScope="new-thread"
      onSubmit={() => undefined}
    >
      {(composer) =>
        composer.renderPromptBox({ mentionMenuPlacement: "bottom" })
      }
    </NewThreadComposer>
  );
}

function rootLikeElement(
  projectId: string,
  draftStorage?: PromptDraftScope,
  carryDraftToProject?: NewThreadComposerProps["carryDraftToProject"],
) {
  return (
    <Provider>
      <MemoryRouter>
        <RootLikeComposer
          initialProjectId={projectId}
          draftStorage={draftStorage}
          carryDraftToProject={carryDraftToProject}
        />
      </MemoryRouter>
    </Provider>
  );
}

function currentHost(): PluginComposerHost {
  const host = latestPromptBoxProps().pluginComposerHost as PluginComposerHost;
  expect(host.setSelection).toBeDefined();
  return host;
}

async function settled(
  promise: Promise<ExperimentalComposerSelection>,
  timeout = 1_000,
): Promise<ExperimentalComposerSelection> {
  let result: ExperimentalComposerSelection | null = null;
  let failure: unknown = null;
  void promise.then(
    (value) => {
      result = value;
    },
    (error: unknown) => {
      failure = error;
    },
  );
  await waitFor(
    () => {
      expect(result !== null || failure !== null).toBe(true);
    },
    { timeout },
  );
  if (failure !== null) throw failure;
  return promise;
}

describe("PluginNewThreadComposer project draft carry", () => {
  beforeEach(() => {
    mocks.promptBoxProps.length = 0;
    mocks.copyAttachments.mockReset();
    mocks.uploadAttachment.mockReset();
    mocks.environmentProviders = [CHECKOUT_PROVIDER];
    mocks.machineProviders = [];
    resetPluginSlotStoreForTest();
    registerCheckoutInputsControl();
    window.localStorage.clear();
    window.sessionStorage.clear();
    getPromptDraftAccessor({
      kind: "new-thread",
      projectId: "proj_1",
    }).setDraft({ text: "", mentions: [], attachments: [] });
  });

  afterEach(() => {
    cleanup();
    setComposerSelectionSettleTimeoutForTest(null);
    vi.restoreAllMocks();
  });

  it("carries the draft and its uploads to the selected project when asked", async () => {
    mocks.copyAttachments.mockResolvedValue(undefined);
    const attachment = {
      type: "localFile" as const,
      path: "uploads/spec.md",
      name: "spec.md",
      sizeBytes: 12,
    };
    getPromptDraftAccessor({
      kind: "new-thread",
      projectId: "proj_1",
    }).setDraft({
      text: "Continue from here",
      mentions: [],
      attachments: [attachment],
    });
    getPromptDraftAccessor({
      kind: "new-thread",
      projectId: "proj_2",
    }).setDraft({ text: "proj_2 notes", mentions: [], attachments: [] });
    const carryDraftToProject = vi.fn(
      (draft: PromptDraftState, targetDraft: PromptDraftState) => ({
        ...draft,
        text: `${draft.text}\n\n${targetDraft.text}`,
      }),
    );
    render(rootLikeElement("proj_1", undefined, carryDraftToProject));

    await act(async () => {
      await latestPromptBoxProps().project.onChange("proj_2");
    });

    expect(mocks.copyAttachments).toHaveBeenCalledWith({
      projectId: "proj_2",
      sourceProjectId: "proj_1",
      paths: ["uploads/spec.md"],
    });
    expect(latestPromptBoxProps().project.value).toBe("proj_2");
    expect(latestPromptBoxProps().value).toBe(
      "Continue from here\n\nproj_2 notes",
    );
    expect(latestPromptBoxProps().attachments.items).toHaveLength(1);
    expect(
      getPromptDraftAccessor({
        kind: "new-thread",
        projectId: "proj_1",
      }).getCurrent().text,
    ).toBe("");
  });

  it("leaves the project alone when a copy or upload is in flight, and still applies the rest", async () => {
    mocks.copyAttachments.mockReturnValue(new Promise(() => {}));
    getPromptDraftAccessor({
      kind: "plugin-new-thread",
      key: "copy-in-flight",
    }).setDraft({
      text: "with a file",
      mentions: [],
      attachments: [
        {
          type: "localFile",
          path: "uploads/spec.md",
          name: "spec.md",
          sizeBytes: 12,
        },
      ],
    });
    render(
      rootLikeElement("proj_1", {
        kind: "plugin-new-thread",
        key: "copy-in-flight",
      }),
    );
    const host = currentHost();
    void latestPromptBoxProps().project.onChange("proj_2");
    await waitFor(() => {
      expect(mocks.copyAttachments).toHaveBeenCalledTimes(1);
    });

    const result = await settled(
      host.setSelection!({ projectId: "proj_2", permissionMode: "full" }),
    );

    expect(result.projectId).toBe("proj_1");
    expect(result.permissionMode).toBe("full");
    expect(mocks.copyAttachments).toHaveBeenCalledTimes(1);
  });
});
