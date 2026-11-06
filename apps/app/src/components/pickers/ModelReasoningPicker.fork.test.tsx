// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  AvailableModel,
  ProviderInfo,
  ProviderOptionDescriptor,
  ReasoningLevel,
  ServiceTier,
} from "@bb/domain";
import { makeProviderInfo } from "@bb/test-helpers/domain-fixtures";
import type {
  SystemExecutionOptionsModelLoadError,
  SystemExecutionOptionsResponse,
  SystemProvidersQuery,
} from "@bb/server-contract";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { systemExecutionOptionsQueryKey } from "@/hooks/queries/query-keys";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { setPluginAssetIcons } from "@bb/shared-ui/icon-registry";
import {
  PaneContext,
  type PaneContextValue,
} from "@/views/thread-detail/PaneContext";
import {
  ModelReasoningPicker,
  type ModelReasoningPickerHandoff,
} from "./ModelReasoningPicker";
import { ModelReasoningMenu } from "./ModelReasoningMenuSplit";
import type { PickerOption } from "./OptionPicker";
import type { ProviderPickerOption } from "./model-brand-prefix";
import type { ModelPickerOption } from "./model-picker-option";
import {
  buildSessionOptionMenuSections,
  type SessionOptionChoice,
  type SessionOptionMenuSection,
} from "./SessionOptionsMenu";

type CapturedCommandHandler = (invocation: {
  target: EventTarget | null;
}) => boolean;

const commandHandlers = vi.hoisted(
  () => new Map<string, CapturedCommandHandler>(),
);

vi.mock("@/lib/sdk", () => ({
  sdk: {
    system: {
      executionOptions: vi.fn(() => new Promise<never>(() => undefined)),
    },
  },
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandContext: () => undefined,
  useAppCommandHandler: (command: string, handler: CapturedCommandHandler) => {
    commandHandlers.set(command, handler);
  },
  useIndexedAppCommandHandlers: (
    commands: readonly string[],
    handler: (
      index: number,
      invocation: { target: EventTarget | null },
    ) => boolean,
  ) => {
    commands.forEach((command, index) => {
      commandHandlers.set(command, (invocation) => handler(index, invocation));
    });
  },
  useAppCommandShortcut: () => null,
  useIsAppCommandModifierHeld: () => false,
}));

const providerOptions: readonly ProviderPickerOption[] = [
  { value: "codex", label: "Codex", brandPrefix: "GPT-" },
  { value: "claude-code", label: "Claude Code", brandPrefix: "Claude " },
];

const codexModels: readonly PickerOption<string>[] = [
  { value: "gpt-5.5", label: "GPT-5.5" },
];

const reasoningOptions: readonly PickerOption<ReasoningLevel>[] = [
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const splitPaneContext: PaneContextValue = {
  paneId: "test-pane",
  isFocused: true,
  isSplitPane: true,
  secondaryPanelHost: null,
  reservesWindowPanelToggle: false,
  onRequestClose: null,
  isMaximized: false,
  onToggleMaximize: null,
  isBoundedPane: true,
  isTopRow: true,
  ownsWindowTopLeft: true,
  navigateInPane: () => undefined,
};

function availableModel({
  value,
  label,
  isDefault = false,
}: {
  value: string;
  label: string;
  isDefault?: boolean;
}): AvailableModel {
  return {
    id: value,
    model: value,
    displayName: label,
    description: "",
    reasoningDiscovery: "known" as const,
    supportedReasoningEfforts: [
      { reasoningEffort: "medium", description: "Medium" },
    ],
    defaultReasoningEffort: "medium",
    isDefault,
  };
}

function executionOptions({
  models,
  selectedOnlyModels = [],
  providers = [],
}: {
  models: AvailableModel[];
  selectedOnlyModels?: AvailableModel[];
  providers?: ProviderInfo[];
}): SystemExecutionOptionsResponse {
  return {
    providers,
    models,
    selectedOnlyModels,
    permissionCeiling: "full",
    modelLoadError: null,
  };
}

function renderPicker({
  onSelectedProviderChange = vi.fn(),
  onModelChange = vi.fn(),
  onReasoningChange = vi.fn(),
  onServiceTierChange = vi.fn(),
  serviceTierValue,
  serviceTierOptions = [],
  serviceTierSupportByProvider,
  alternateProvider = makeProviderInfo({ id: "claude-code" }),
  modelOptions = codexModels,
  modelValue = modelOptions[0]?.value ?? "",
  pickerReasoningOptions = reasoningOptions,
  reasoningValue = "medium",
  moreModelOptions = [],
  pickerProviderOptions = providerOptions,
  alternateProviderModels,
  providerRouting,
  selectedProviderId = "codex",
  modelIsLoading = false,
  modelLoadError = null,
  compact = false,
  splitPane = false,
  muted = false,
  handoff,
  agentSections,
  onAgentOptionChange = vi.fn(),
}: {
  onSelectedProviderChange?: ((value: string) => void) | null;
  onModelChange?: (value: string) => void;
  onReasoningChange?: (value: ReasoningLevel) => void;
  onServiceTierChange?: (value: ServiceTier) => void;
  serviceTierValue?: ServiceTier;
  serviceTierOptions?: readonly ProviderOptionDescriptor[];
  serviceTierSupportByProvider?: Record<string, boolean>;
  alternateProvider?: ProviderInfo;
  modelOptions?: readonly ModelPickerOption[];
  modelValue?: string;
  pickerReasoningOptions?: readonly PickerOption<ReasoningLevel>[];
  reasoningValue?: ReasoningLevel;
  moreModelOptions?: readonly ModelPickerOption[];
  pickerProviderOptions?: readonly ProviderPickerOption[];
  alternateProviderModels?: AvailableModel[];
  providerRouting?: SystemProvidersQuery;
  selectedProviderId?: string;
  modelIsLoading?: boolean;
  modelLoadError?: SystemExecutionOptionsModelLoadError | null;
  compact?: boolean;
  splitPane?: boolean;
  muted?: boolean;
  handoff?: ModelReasoningPickerHandoff;
  agentSections?: readonly SessionOptionMenuSection[];
  onAgentOptionChange?: (optionId: string, value: SessionOptionChoice) => void;
} = {}) {
  const { queryClient, wrapper } = createQueryClientTestHarness();
  queryClient.setQueryData(
    systemExecutionOptionsQueryKey({
      environmentId: providerRouting?.environmentId ?? null,
      hostId: providerRouting?.hostId ?? null,
      providerId: "claude-code",
    }),
    executionOptions({
      models: alternateProviderModels ?? [
        availableModel({
          value: "claude-opus-4-7",
          label: "Claude Opus 4.7",
          isDefault: true,
        }),
      ],
      providers: [alternateProvider],
    }),
  );

  const picker = (
    <div data-app-composer>
      <ModelReasoningPicker
        providerOptions={pickerProviderOptions}
        providerRouting={providerRouting}
        selectedProviderId={selectedProviderId}
        onSelectedProviderChange={onSelectedProviderChange ?? undefined}
        hasMultipleProviders
        modelValue={modelValue}
        modelOptions={modelOptions}
        moreModelOptions={moreModelOptions}
        modelIsLoading={modelIsLoading}
        modelLoadError={modelLoadError}
        onModelChange={onModelChange}
        reasoningValue={reasoningValue}
        reasoningOptions={pickerReasoningOptions}
        onReasoningChange={onReasoningChange}
        serviceTierValue={serviceTierValue}
        serviceTierOptions={serviceTierOptions}
        onServiceTierChange={onServiceTierChange}
        serviceTierSupportByProvider={serviceTierSupportByProvider}
        muted={muted}
        modal={false}
        handoff={handoff}
        agentSections={agentSections}
        onAgentOptionChange={onAgentOptionChange}
      />
      <button type="button">Composer action</button>
    </div>
  );
  const pickerWithPane = splitPane ? (
    <PaneContext.Provider value={splitPaneContext}>
      {picker}
    </PaneContext.Provider>
  ) : (
    picker
  );
  render(
    compact ? (
      <CompactViewportOverrideProvider isCompactViewport>
        {pickerWithPane}
      </CompactViewportOverrideProvider>
    ) : (
      pickerWithPane
    ),
    { wrapper },
  );

  return {
    onSelectedProviderChange,
    onModelChange,
    onReasoningChange,
    onServiceTierChange,
    onAgentOptionChange,
  };
}

afterEach(() => {
  cleanup();
  commandHandlers.clear();
  vi.clearAllMocks();
});

beforeAll(() => ModelReasoningMenu.preload());
afterEach(() => setPluginAssetIcons(new Map()));

function openPicker(): void {
  fireEvent.click(
    screen.getByRole("button", { name: "Provider, model and reasoning" }),
  );
}

describe("fork migration coverage", () => {
  it("keeps the more-models submenu open when opened from the keyboard without a prior hover", async () => {
    renderPicker({ moreModelOptions: [{ value: "legacy", label: "Legacy" }] });
    fireEvent.click(
      screen.getByRole("button", { name: "Provider, model and reasoning" }),
    );

    const moreModels = screen.getByRole("button", { name: "More models" });
    fireEvent.keyDown(moreModels, { key: "Enter" });
    expect(await screen.findByRole("button", { name: "Legacy" })).toBeTruthy();
    expect(moreModels.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Legacy" }),
      ),
    );
  });

  it("closes a keyboard-opened more-models submenu after its row is hovered and navigation moves on", async () => {
    renderPicker({ moreModelOptions: [{ value: "legacy", label: "Legacy" }] });
    fireEvent.click(
      screen.getByRole("button", { name: "Provider, model and reasoning" }),
    );

    const moreModels = screen.getByRole("button", { name: "More models" });
    fireEvent.keyDown(moreModels, { key: "Enter" });
    expect(await screen.findByRole("button", { name: "Legacy" })).toBeTruthy();

    fireEvent.pointerEnter(moreModels);
    fireEvent.keyDown(moreModels, { key: "ArrowDown" });
    expect(screen.queryByRole("button", { name: "Legacy" })).toBeNull();
    expect(document.activeElement).toBe(moreModels);
  });

  describe("long session-option selects", () => {
    const selectOption = (
      count: number,
      id = "agent",
      label = "Main-thread agent persona",
    ) => ({
      type: "select" as const,
      id,
      label,
      description: null,
      category: null,
      value: `${id}-0`,
      pendingValue: null,
      values: Array.from({ length: count }, (_, index) => ({
        id: `${id}-${index}`,
        label: `Agent ${index}`,
        description: null,
        group: null,
      })),
    });
    const sectionsFor = (count: number) =>
      buildSessionOptionMenuSections([selectOption(count)], {});
    const twoSections = () =>
      buildSessionOptionMenuSections(
        [selectOption(69), selectOption(69, "depth", "Depth persona")],
        {},
      );

    it("collapses a 69-value select into one row and keeps the models", async () => {
      renderPicker({ agentSections: sectionsFor(69) });
      openPicker();

      expect(
        screen.queryByRole("radiogroup", { name: "Main-thread agent persona" }),
      ).toBeNull();
      expect(
        screen.queryAllByRole("radio", { name: /^Agent \d+$/ }),
      ).toHaveLength(0);
      const row = screen.getByRole("button", {
        name: /Main-thread agent persona/,
      });
      expect(row.getAttribute("aria-haspopup")).toBe("menu");
      expect(row.textContent).toContain("Agent 0");
      expect(screen.getAllByText("5.5")).toHaveLength(2);
    });

    it("keeps a 2-value select as a toggle group", () => {
      renderPicker({ agentSections: sectionsFor(2) });
      openPicker();

      expect(
        screen.getByRole("radiogroup", { name: "Main-thread agent persona" }),
      ).toBeTruthy();
      expect(
        screen.getAllByRole("radio", { name: /^Agent \d+$/ }),
      ).toHaveLength(2);
    });

    it("keeps a 6-value select as a toggle group", () => {
      renderPicker({ agentSections: sectionsFor(6) });
      openPicker();

      expect(
        screen.getAllByRole("radio", { name: /^Agent \d+$/ }),
      ).toHaveLength(6);
    });

    it("keeps the submenu open when opened from the keyboard without a prior hover", async () => {
      renderPicker({ agentSections: sectionsFor(69) });
      openPicker();

      const row = screen.getByRole("button", {
        name: /Main-thread agent persona/,
      });
      fireEvent.keyDown(row, { key: "Enter" });
      const items = await screen.findAllByRole("menuitemradio");
      expect(items).toHaveLength(69);
      expect(row.getAttribute("aria-expanded")).toBe("true");
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByRole("menuitemradio", { name: "Agent 0" }),
        ),
      );
    });

    it("closes a pointer-opened submenu when another row is hovered", async () => {
      renderPicker({ agentSections: twoSections() });
      openPicker();

      fireEvent.pointerEnter(
        screen.getByRole("button", { name: /Main-thread agent persona/ }),
      );
      expect(
        await screen.findByRole("menu", { name: "Main-thread agent persona" }),
      ).toBeTruthy();

      fireEvent.pointerEnter(
        screen.getByRole("button", { name: /Depth persona/ }),
      );
      expect(
        screen.queryByRole("menu", { name: "Main-thread agent persona" }),
      ).toBeNull();
      expect(screen.getByRole("menu", { name: "Depth persona" })).toBeTruthy();
    });

    it("closes a keyboard-opened submenu when another row is hovered", async () => {
      renderPicker({ agentSections: twoSections() });
      openPicker();

      fireEvent.keyDown(
        screen.getByRole("button", { name: /Main-thread agent persona/ }),
        { key: "Enter" },
      );
      expect(
        await screen.findByRole("menu", { name: "Main-thread agent persona" }),
      ).toBeTruthy();

      fireEvent.pointerEnter(
        screen.getByRole("button", { name: /Depth persona/ }),
      );
      expect(
        screen.queryByRole("menu", { name: "Main-thread agent persona" }),
      ).toBeNull();
      expect(screen.getByRole("menu", { name: "Depth persona" })).toBeTruthy();
    });

    it("restores focus to the row after selecting an item from a keyboard-opened submenu", async () => {
      const { onAgentOptionChange } = renderPicker({
        agentSections: sectionsFor(69),
      });
      openPicker();

      const row = screen.getByRole("button", {
        name: /Main-thread agent persona/,
      });
      fireEvent.keyDown(row, { key: "Enter" });
      fireEvent.click(
        await screen.findByRole("menuitemradio", { name: "Agent 42" }),
      );
      expect(onAgentOptionChange).toHaveBeenLastCalledWith("agent", "agent-42");
      expect(document.activeElement).toBe(row);
    });

    it("does not change reasoning when ArrowRight is pressed inside the submenu", async () => {
      const { onReasoningChange } = renderPicker({
        agentSections: sectionsFor(69),
      });
      openPicker();

      fireEvent.keyDown(
        screen.getByRole("button", { name: /Main-thread agent persona/ }),
        { key: "Enter" },
      );
      const item = await screen.findByRole("menuitemradio", {
        name: "Agent 0",
      });
      fireEvent.keyDown(item, { key: "ArrowRight" });
      expect(onReasoningChange).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(item);
    });

    it("keeps a click-opened submenu open on hover-loss and closes it once the pointer takes over", async () => {
      renderPicker({ agentSections: sectionsFor(69) });
      openPicker();

      const row = screen.getByRole("button", {
        name: /Main-thread agent persona/,
      });
      fireEvent.click(row);
      expect(
        await screen.findByRole("menu", { name: "Main-thread agent persona" }),
      ).toBeTruthy();
      fireEvent.keyDown(row, { key: "ArrowDown" });
      expect(
        screen.getByRole("menu", { name: "Main-thread agent persona" }),
      ).toBeTruthy();

      fireEvent.pointerEnter(row);
      fireEvent.keyDown(row, { key: "ArrowDown" });
      expect(
        screen.queryByRole("menu", { name: "Main-thread agent persona" }),
      ).toBeNull();
    });

    it("restores focus to the submenu row after selecting an item", async () => {
      const { onAgentOptionChange } = renderPicker({
        agentSections: sectionsFor(69),
      });
      openPicker();

      const row = screen.getByRole("button", {
        name: /Main-thread agent persona/,
      });
      fireEvent.pointerEnter(row);
      fireEvent.click(
        await screen.findByRole("menuitemradio", { name: "Agent 42" }),
      );
      expect(onAgentOptionChange).toHaveBeenLastCalledWith("agent", "agent-42");
      expect(document.activeElement).toBe(row);
    });

    it("reports the chosen item from the submenu and closes it", async () => {
      const { onAgentOptionChange } = renderPicker({
        agentSections: sectionsFor(69),
      });
      openPicker();

      fireEvent.pointerEnter(
        screen.getByRole("button", { name: /Main-thread agent persona/ }),
      );
      const items = await screen.findAllByRole("menuitemradio");
      expect(items).toHaveLength(69);
      expect(items[0]?.getAttribute("aria-checked")).toBe("true");

      fireEvent.click(screen.getByRole("menuitemradio", { name: "Agent 42" }));
      expect(onAgentOptionChange).toHaveBeenLastCalledWith("agent", "agent-42");
      expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
    });

    it("lists the items inline in a bounded scroller on compact viewports", async () => {
      const { onAgentOptionChange } = renderPicker({
        agentSections: sectionsFor(69),
        compact: true,
      });
      openPicker();

      const list = await screen.findByRole("menu", {
        name: "Main-thread agent persona",
      });
      expect(list.classList.contains("overflow-y-auto")).toBe(true);
      expect(list.classList.contains("max-h-48")).toBe(true);
      fireEvent.click(screen.getByRole("menuitemradio", { name: "Agent 7" }));
      expect(onAgentOptionChange).toHaveBeenLastCalledWith("agent", "agent-7");
    });
  });
});
