// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PluginComposerAsideRegistration,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type {
  UsageMachine,
  UsageProvider,
  UsageSnapshot,
} from "./usage-schema.js";

const CARD_MAX_AGE_MS = 2 * 60_000;

type FetchBody = {
  force: boolean;
  machineIds: string[] | null;
  maxAgeMs: number;
  providerIds: string[];
};

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

let threadSequence = 0;

function asideThread(
  overrides: Partial<PluginSidebarThread> & { id: string },
): PluginSidebarThread {
  threadSequence += 1;
  return {
    projectId: "project-one",
    title: overrides.id,
    titleFallback: null,
    displayTitle: overrides.id,
    parentThreadId: null,
    parentNotifications: "auto",
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    pendingInteractionKind: null,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: `/projects/project-one/threads/${overrides.id}`,
    isHidden: false,
    environment: null,
    host: { id: "host-m4", name: "M4" },
    createdAt: threadSequence,
    updatedAt: threadSequence,
    lastReadAt: threadSequence,
    latestAttentionAt: threadSequence,
    ...overrides,
  };
}

function usageWindow(
  usedPercent: number,
  resetInHours: number | null,
  label = "Five-hour limit",
) {
  return {
    label,
    usedPercent,
    resetsAt:
      resetInHours === null
        ? null
        : new Date(Date.now() + resetInHours * 3_600_000).toISOString(),
    cost: null,
  };
}

function usageOk(
  usedPercent: number,
  resetInHours: number | null,
  extraWindows: ReturnType<typeof usageWindow>[] = [],
): UsageProvider["usage"] {
  return {
    status: "ok",
    accountEmail: null,
    planLabel: null,
    windows: [usageWindow(usedPercent, resetInHours), ...extraWindows],
  };
}

function providerRow(
  overrides: Partial<UsageProvider> & { id: string; providerId: string },
): UsageProvider {
  return {
    accountLabel: null,
    displayName: overrides.providerId,
    logoUrl: `/api/v1/system/providers/${overrides.providerId}/logo`,
    icon: null,
    strings: { iconTint: null },
    signInHint: "Sign in.",
    expiredHint: "Sign in again.",
    usage: null,
    ...overrides,
  };
}

function machineRow(
  overrides: Partial<UsageMachine> & { id: string },
): UsageMachine {
  return {
    displayName: overrides.id,
    status: "connected",
    providers: [],
    error: null,
    ...overrides,
  };
}

function snapshotResponse(machines: UsageMachine[]): Response {
  return Response.json({
    ok: true,
    result: { machines } satisfies UsageSnapshot,
  });
}

function stubAsideFetch(
  respond: (body: FetchBody, call: number) => Response | Promise<Response>,
) {
  let call = 0;
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      call += 1;
      return respond(JSON.parse(String(init?.body)) as FetchBody, call);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestBodies(fetchMock: ReturnType<typeof vi.fn>): FetchBody[] {
  return fetchMock.mock.calls.map((call) =>
    JSON.parse(String(call[1]?.body)),
  ) as FetchBody[];
}

function asideBodies(bodies: FetchBody[]): FetchBody[] {
  return bodies.filter((body) => body.machineIds?.[0] === "host-m4");
}

function isComposerAsideRegistration(
  value: unknown,
): value is PluginComposerAsideRegistration {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "id") === "string" &&
    typeof Reflect.get(value, "title") === "string" &&
    typeof Reflect.get(value, "component") === "function"
  );
}

function firstComposerAside(
  app: Awaited<ReturnType<typeof loadPluginApp>>,
): PluginComposerAsideRegistration {
  const registrations = Reflect.get(app, "composerAsides");
  const registration = Array.isArray(registrations)
    ? registrations.find(isComposerAsideRegistration)
    : undefined;
  if (registration === undefined) throw new Error("missing composer aside");
  return registration;
}

async function renderAside(options: {
  threads: PluginSidebarThread[];
  status?: "ready" | "loading";
  threadId?: string;
}) {
  const { definePluginApp } = await import("@get-bb/plugin-sdk/app");
  const { registerComposerAside } = await import("./composer-aside.fork");
  const app = await loadPluginApp(definePluginApp(registerComposerAside));
  const registration = firstComposerAside(app);
  expect(registration.id).toBe("usage");
  expect(registration.title).toBe("Provider usage");
  return renderSlot(
    registration,
    {
      threadId: options.threadId ?? "thread-current",
      projectId: "project-one",
    },
    {
      pluginId: "bb--provider-usage",
      sidebarThreads: {
        threads: options.threads,
        status: options.status ?? "ready",
      },
    },
  );
}

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await act(async () => {});
}

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

it("renders nothing while loading, when the thread is absent or archived, and when no pair survives", async () => {
  stubAsideFetch(() => snapshotResponse([]));
  const current = asideThread({
    id: "thread-current",
    providerId: "claude-code",
  });
  const absent = await renderAside({
    threads: [current],
    threadId: "thread-other",
  });
  expect(absent.container.textContent).toBe("");
  absent.unmount();
  const loading = await renderAside({ threads: [current], status: "loading" });
  expect(loading.container.textContent).toBe("");
  loading.unmount();
  const archived = await renderAside({
    threads: [
      asideThread({ id: "thread-current", isArchived: true, archivedAt: 5 }),
    ],
  });
  expect(archived.container.textContent).toBe("");
  archived.unmount();
  const noHost = await renderAside({
    threads: [asideThread({ id: "thread-current", host: null })],
  });
  expect(noHost.container.textContent).toBe("");
  noHost.unmount();
});

it("shows the offline message for a disconnected machine in both variants", async () => {
  const fetchMock = stubAsideFetch((_body, call) =>
    snapshotResponse([
      machineRow({
        id: "host-intel",
        displayName: "Intel",
        status: "disconnected",
        providers:
          call === 1
            ? []
            : [
                providerRow({
                  id: "intel-codex",
                  providerId: "codex",
                  displayName: "Codex",
                  usage: usageOk(33, 2),
                }),
              ],
      }),
    ]),
  );
  const first = await renderAside({
    threads: [
      asideThread({
        id: "thread-current",
        host: { id: "host-intel", name: "Intel" },
      }),
    ],
  });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  expect(
    first.getByText("Intel is offline. Usage will refresh when it reconnects."),
  ).toBeTruthy();
  first.unmount();
  const second = await renderAside({
    threads: [
      asideThread({
        id: "thread-current",
        host: { id: "host-intel", name: "Intel" },
      }),
    ],
  });
  await flush();
  expect(fetchMock).toHaveBeenCalledOnce();
  const realNow = Date.now();
  const now = vi.spyOn(Date, "now");
  now.mockReturnValue(realNow + 121_000);
  window.dispatchEvent(new Event("focus"));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(
    second.getByText("Intel is offline. Showing last update."),
  ).toBeTruthy();
  expect(second.getByText("33%")).toBeTruthy();
});

it("renders current plus descendant pairs, deduped after source resolution, with pooled ordinals and sr-only emails", async () => {
  const pool = machineRow({
    id: "source:account-pool",
    displayName: "Account Pooler",
    providers: [
      providerRow({
        id: "pool-claude-1",
        providerId: "claude-code",
        displayName: "Claude Code",
        accountLabel: "one@example.com",
        usage: {
          status: "ok",
          accountEmail: "one@example.com",
          planLabel: null,
          windows: [usageWindow(29, 2.25), usageWindow(44, 83, "Weekly limit")],
        },
      }),
      providerRow({
        id: "pool-claude-2",
        providerId: "claude-code",
        displayName: "Claude Code",
        accountLabel: "two@example.com",
        usage: {
          status: "ok",
          accountEmail: "two@example.com",
          planLabel: null,
          windows: [usageWindow(71, 83)],
        },
      }),
      providerRow({
        id: "pool-codex",
        providerId: "codex",
        displayName: "Codex",
        accountLabel: "pool@example.com",
        usage: {
          status: "ok",
          accountEmail: "pool@example.com",
          planLabel: null,
          windows: [usageWindow(12, null)],
        },
      }),
    ],
  });
  const hostM4 = machineRow({
    id: "host-m4",
    displayName: "M4",
    providers: [
      providerRow({
        id: "m4-claude",
        providerId: "claude-code",
        displayName: "Claude Code",
        usage: usageOk(88, null),
      }),
      providerRow({
        id: "m4-codex",
        providerId: "codex",
        displayName: "Codex",
        usage: usageOk(41, null),
      }),
      providerRow({
        id: "m4-glm",
        providerId: "glm",
        displayName: "GLM",
        usage: { status: "unauthenticated" },
        signInHint:
          "Put the API token for this profile in /hosts/m4/token (chmod 600), then reload.",
      }),
      providerRow({
        id: "m4-cursor",
        providerId: "acp-cursor",
        displayName: "Cursor",
        usage: usageOk(7, null),
      }),
      providerRow({
        id: "m4-gemini",
        providerId: "gemini",
        displayName: "Gemini",
        usage: usageOk(55, null),
      }),
    ],
  });
  const hostM5 = machineRow({
    id: "host-m5",
    displayName: "M5",
    providers: [
      providerRow({
        id: "m5-codex",
        providerId: "codex",
        displayName: "Codex",
        usage: usageOk(63, null),
      }),
    ],
  });
  const machines = [hostM4, hostM5, pool];
  const firstResponse = deferredResponse();
  const fetchMock = stubAsideFetch((_body, call) =>
    call === 1 ? firstResponse.promise : snapshotResponse(machines),
  );
  const current = asideThread({
    id: "thread-current",
    providerId: "claude-code",
  });
  const threads = [
    current,
    asideThread({ id: "thread-child-codex", parentThreadId: current.id }),
    asideThread({
      id: "thread-child-glm",
      parentThreadId: current.id,
      providerId: "glm",
    }),
    asideThread({
      id: "thread-child-cursor",
      parentThreadId: current.id,
      providerId: "acp-cursor",
      isHidden: true,
    }),
    asideThread({
      id: "thread-child-fork",
      parentThreadId: current.id,
      providerId: "gemini",
      originKind: "fork",
      sourceThreadId: current.id,
    }),
    asideThread({
      id: "thread-fork-child",
      parentThreadId: "thread-child-fork",
      providerId: "gemini",
    }),
    asideThread({
      id: "thread-child-nohost",
      parentThreadId: current.id,
      providerId: "gemini",
      host: null,
    }),
    asideThread({
      id: "thread-child-cross",
      parentThreadId: current.id,
      host: { id: "host-m5", name: "M5" },
    }),
    asideThread({ id: "thread-unrelated", providerId: "gemini" }),
  ];
  const slot = await renderAside({ threads });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  firstResponse.resolve(snapshotResponse(machines));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  const bodies = requestBodies(fetchMock);
  expect(
    bodies.filter((body) => body.machineIds?.join("\n") === "host-m4"),
  ).toEqual([
    {
      force: false,
      machineIds: ["host-m4"],
      maxAgeMs: CARD_MAX_AGE_MS,
      providerIds: ["acp-cursor", "claude-code", "codex", "glm"],
    },
  ]);
  expect(
    bodies.filter((body) => body.machineIds?.join("\n") === "host-m5"),
  ).toEqual([
    {
      force: false,
      machineIds: ["host-m5"],
      maxAgeMs: CARD_MAX_AGE_MS,
      providerIds: ["codex"],
    },
  ]);
  expect(
    bodies.filter(
      (body) => body.machineIds?.join("\n") === "host-m4\nsource:account-pool",
    ),
  ).toEqual([
    {
      force: false,
      machineIds: ["host-m4", "source:account-pool"],
      maxAgeMs: CARD_MAX_AGE_MS,
      providerIds: ["acp-cursor", "claude-code", "codex", "glm"],
    },
  ]);
  expect(
    bodies.filter(
      (body) => body.machineIds?.join("\n") === "host-m5\nsource:account-pool",
    ),
  ).toEqual([
    {
      force: false,
      machineIds: ["host-m5", "source:account-pool"],
      maxAgeMs: CARD_MAX_AGE_MS,
      providerIds: ["codex"],
    },
  ]);
  await waitFor(() =>
    expect(slot.getByText("Account Pooler · Claude Code")).toBeTruthy(),
  );
  expect(slot.getByText("This thread")).toBeTruthy();
  expect(slot.getByText("Subthreads")).toBeTruthy();
  expect(slot.getAllByText("Account Pooler · 1")).toHaveLength(2);
  expect(slot.getByText("Account Pooler · 2")).toBeTruthy();
  expect(slot.getAllByText("Account Pooler · Codex")).toHaveLength(1);
  expect(slot.getByText("M4 · GLM")).toBeTruthy();
  expect(
    slot.getByText(
      "Put the API token for this profile in /hosts/m4/token (chmod 600), then reload.",
    ),
  ).toBeTruthy();
  expect(slot.getByText("M4 · Cursor")).toBeTruthy();
  expect(slot.getByText("29%")).toBeTruthy();
  expect(slot.getByText("44%")).toBeTruthy();
  expect(slot.getByText("71%")).toBeTruthy();
  expect(slot.getByText("12%")).toBeTruthy();
  expect(slot.getByText("7%")).toBeTruthy();
  expect(slot.getByText("2h 15m")).toBeTruthy();
  expect(slot.queryByText("88%")).toBeNull();
  expect(slot.queryByText("41%")).toBeNull();
  expect(slot.queryByText("63%")).toBeNull();
  expect(slot.queryByText("Gemini")).toBeNull();
  expect(slot.queryByText("55%")).toBeNull();
  expect(slot.getAllByText(/one@example\.com/u).length).toBeGreaterThan(0);
  expect(
    [...slot.container.querySelectorAll('[aria-hidden="true"]')]
      .map((node) => node.textContent)
      .join(" "),
  ).not.toContain("one@example.com");
  expect(slot.container.textContent).toContain("one@example.com");
  const screenReaderText = [...slot.container.querySelectorAll(".sr-only")].map(
    (node) => node.textContent,
  );
  expect(screenReaderText).toContain(
    "Claude Code Account Pooler · 1 (one@example.com) Five-hour limit: 29% used, resets in 2h 15m",
  );
  expect(slot.container.querySelectorAll('[role="status"]')).toHaveLength(0);
  await slot.unmount();
});

it("shows a skeleton during the mount debounce window instead of nothing", async () => {
  stubAsideFetch(() => snapshotResponse([]));
  const slot = await renderAside({
    threads: [asideThread({ id: "thread-current" })],
  });
  expect(slot.container.querySelectorAll('[role="status"]').length).toBe(1);
  await waitFor(() =>
    expect(slot.container.querySelector('[role="status"]')).toBeNull(),
  );
  expect(slot.container.textContent).toBe("");
});

it("shows load-failed instead of a skeleton on a failed first request, then the refresh marker over data", async () => {
  const codexRow = providerRow({
    id: "m4-codex",
    providerId: "codex",
    displayName: "Codex",
    usage: usageOk(33, 2),
  });
  const script: Array<() => Response> = [
    () => new Response("nope", { status: 503 }),
    () =>
      snapshotResponse([
        machineRow({
          id: "host-m4",
          displayName: "M4",
          providers: [codexRow],
        }),
      ]),
    () => new Response("nope", { status: 500 }),
    () =>
      snapshotResponse([
        machineRow({
          id: "host-m4",
          displayName: "M4",
          error: "boom",
          providers: [codexRow],
        }),
      ]),
  ];
  const fetchMock = stubAsideFetch((_body, call) =>
    (script[call - 1] ?? (() => snapshotResponse([])))(),
  );
  const slot = await renderAside({
    threads: [asideThread({ id: "thread-current" })],
  });
  await waitFor(() =>
    expect(slot.getByText("Couldn’t load usage.")).toBeTruthy(),
  );
  expect(slot.container.querySelectorAll('[role="status"]')).toHaveLength(0);
  const realNow = Date.now();
  const now = vi.spyOn(Date, "now");
  now.mockReturnValue(realNow + 301_000);
  window.dispatchEvent(new Event("focus"));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(slot.getByText("33%")).toBeTruthy());
  expect(slot.queryByText("Couldn’t load usage.")).toBeNull();
  for (const offset of [422_000, 723_000]) {
    now.mockReturnValue(realNow + offset);
    window.dispatchEvent(new Event("focus"));
    await waitFor(() =>
      expect(
        slot.getByText("Couldn’t refresh. Showing last update."),
      ).toBeTruthy(),
    );
    expect(slot.getByText("33%")).toBeTruthy();
    expect(
      slot.container.textContent?.split(
        "Couldn’t refresh. Showing last update.",
      ).length,
    ).toBe(2);
  }
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(slot.queryByText(/boom/u)).toBeNull();
});

it("names the failing machine when rows span several machines and keeps other machines working", async () => {
  let failHostM4 = false;
  stubAsideFetch(({ machineIds }) => {
    if (failHostM4 && machineIds?.[0] === "host-m4")
      return new Response("nope", { status: 500 });
    return snapshotResponse([
      machineRow({
        id: "host-m4",
        displayName: "M4",
        providers: [
          providerRow({
            id: "m4-claude",
            providerId: "claude-code",
            displayName: "Claude Code",
            usage: usageOk(29, 2),
          }),
        ],
      }),
      machineRow({
        id: "host-m5",
        displayName: "M5",
        providers: [
          providerRow({
            id: "m5-codex",
            providerId: "codex",
            displayName: "Codex",
            usage: usageOk(63, 4),
          }),
        ],
      }),
    ]);
  });
  const slot = await renderAside({
    threads: [
      asideThread({ id: "thread-current", providerId: "claude-code" }),
      asideThread({
        id: "thread-child",
        parentThreadId: "thread-current",
        host: { id: "host-m5", name: "M5" },
      }),
    ],
  });
  await waitFor(() => expect(slot.getByText("29%")).toBeTruthy());
  await waitFor(() => expect(slot.getByText("63%")).toBeTruthy());
  failHostM4 = true;
  const realNow = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(realNow + 121_000);
  window.dispatchEvent(new Event("focus"));
  await waitFor(() =>
    expect(
      slot.getByText("M4: Couldn’t refresh. Showing last update."),
    ).toBeTruthy(),
  );
  expect(slot.getByText("63%")).toBeTruthy();
  expect(slot.getByText("29%")).toBeTruthy();
});

it("shows the machine-error marker only on the failing machine's group", async () => {
  const fetchMock = stubAsideFetch(() =>
    snapshotResponse([
      machineRow({
        id: "host-m4",
        displayName: "M4",
        providers: [
          providerRow({
            id: "m4-glm",
            providerId: "glm",
            displayName: "GLM",
            usage: usageOk(21, 3),
          }),
        ],
      }),
      machineRow({
        id: "source:account-pool",
        displayName: "Account Pooler",
        error: "boom",
        providers: [
          providerRow({
            id: "pool-claude",
            providerId: "claude-code",
            displayName: "Claude Code",
            usage: usageOk(44, 5),
          }),
        ],
      }),
    ]),
  );
  const slot = await renderAside({
    threads: [
      asideThread({ id: "thread-current", providerId: "claude-code" }),
      asideThread({
        id: "thread-child-glm",
        parentThreadId: "thread-current",
        providerId: "glm",
      }),
    ],
  });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  await waitFor(() => expect(slot.getByText("44%")).toBeTruthy());
  expect(
    slot.getByText("Account Pooler: Couldn’t refresh. Showing last update."),
  ).toBeTruthy();
  expect(
    slot.queryByText("M4: Couldn’t refresh. Showing last update."),
  ).toBeNull();
  expect(slot.queryByText("Couldn’t load usage.")).toBeNull();
  expect(slot.getByText("21%")).toBeTruthy();
  expect(slot.queryByText(/boom/u)).toBeNull();
});

it("seeds source ids from the card snapshot so the first aside request spans the pool", async () => {
  const machines = [
    machineRow({
      id: "host-m4",
      displayName: "M4",
      providers: [
        providerRow({
          id: "m4-codex",
          providerId: "codex",
          displayName: "Codex",
          usage: usageOk(33, 2),
        }),
      ],
    }),
    machineRow({
      id: "source:account-pool",
      displayName: "Account Pooler",
      providers: [
        providerRow({
          id: "pool-codex",
          providerId: "codex",
          displayName: "Codex",
          usage: usageOk(12, 4),
        }),
      ],
    }),
  ];
  const fetchMock = stubAsideFetch(() => snapshotResponse(machines));
  const app = await loadPluginApp(() => import("./app"));
  const item = app.experimentalSidebarFooterItems[0];
  if (item?.kind !== "disclosure") throw new Error("missing disclosure");
  const card = renderSlot(
    item,
    { dismiss: vi.fn() },
    { pluginId: "bb--provider-usage" },
  );
  const reload = card.getByRole("button", {
    name: "Reload provider usage",
  }) as HTMLButtonElement;
  fireEvent.click(reload);
  await waitFor(() =>
    expect(requestBodies(fetchMock).some((body) => body.force)).toBe(true),
  );
  const registration = firstComposerAside(app);
  const aside = renderSlot(
    registration,
    { threadId: "thread-current", projectId: "project-one" },
    {
      pluginId: "bb--provider-usage",
      sidebarThreads: { threads: [asideThread({ id: "thread-current" })] },
    },
  );
  await waitFor(() =>
    expect(asideBodies(requestBodies(fetchMock))).toHaveLength(1),
  );
  expect(asideBodies(requestBodies(fetchMock))[0]?.machineIds).toEqual([
    "host-m4",
    "source:account-pool",
  ]);
  await flush();
  expect(asideBodies(requestBodies(fetchMock))).toHaveLength(1);
  await waitFor(() => expect(aside.container.textContent).toContain("12%"));
  expect(aside.container.textContent).not.toContain("33%");
  await aside.unmount();
  await card.unmount();
});

it("keeps existing rows when a first subthread adds a provider on the same host", async () => {
  const machines = [
    machineRow({
      id: "host-m4",
      displayName: "M4",
      providers: [
        providerRow({
          id: "m4-claude",
          providerId: "claude-code",
          displayName: "Claude Code",
          usage: usageOk(29, 2),
        }),
      ],
    }),
    machineRow({
      id: "source:account-pool",
      displayName: "Account Pooler",
      providers: [
        providerRow({
          id: "pool-glm",
          providerId: "glm",
          displayName: "GLM",
          usage: usageOk(64, 3),
        }),
      ],
    }),
  ];
  const deferred = deferredResponse();
  const fetchMock = stubAsideFetch((_body, call) => {
    if (call <= 2) return snapshotResponse(machines);
    return deferred.promise;
  });
  const first = await renderAside({
    threads: [asideThread({ id: "thread-current", providerId: "claude-code" })],
  });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(first.getByText("29%")).toBeTruthy());
  await first.unmount();
  const second = await renderAside({
    threads: [
      asideThread({ id: "thread-current", providerId: "claude-code" }),
      asideThread({
        id: "thread-child-glm",
        parentThreadId: "thread-current",
        providerId: "glm",
      }),
    ],
  });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  expect(second.getByText("29%")).toBeTruthy();
  expect(second.container.querySelectorAll('[role="status"]')).toHaveLength(0);
  expect(second.queryByText("Couldn’t load usage.")).toBeNull();
  deferred.resolve(snapshotResponse(machines));
  await flush();
  expect(second.getByText("29%")).toBeTruthy();
  expect(second.getByText("Account Pooler · GLM")).toBeTruthy();
  expect(second.getByText("64%")).toBeTruthy();
  const bodies = requestBodies(fetchMock);
  expect(bodies[2]?.providerIds).toEqual(["claude-code", "glm"]);
  expect(bodies[2]?.machineIds).toEqual(["host-m4", "source:account-pool"]);
  await second.unmount();
});

it("requests the provider union for two asides on one host and stays quiet when nothing changes", async () => {
  const machines = [
    machineRow({
      id: "host-m4",
      displayName: "M4",
      providers: [
        providerRow({
          id: "m4-codex",
          providerId: "codex",
          displayName: "Codex",
          usage: usageOk(33, 2),
        }),
        providerRow({
          id: "m4-glm",
          providerId: "glm",
          displayName: "GLM",
          usage: usageOk(64, 3),
        }),
      ],
    }),
  ];
  const fetchMock = stubAsideFetch(() => snapshotResponse(machines));
  const first = await renderAside({
    threads: [asideThread({ id: "thread-a" })],
    threadId: "thread-a",
  });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(requestBodies(fetchMock)[0]?.providerIds).toEqual(["codex"]);
  const second = await renderAside({
    threads: [asideThread({ id: "thread-b", providerId: "glm" })],
    threadId: "thread-b",
  });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(requestBodies(fetchMock)[1]?.providerIds).toEqual(["codex", "glm"]);
  await second.unmount();
  const realNow = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(realNow + 1_000);
  window.dispatchEvent(new Event("focus"));
  await flush();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const third = await renderAside({
    threads: [
      asideThread({ id: "thread-a" }),
      asideThread({ id: "thread-unrelated", providerId: "gemini" }),
    ],
    threadId: "thread-a",
  });
  await flush();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await third.unmount();
  await first.unmount();
});

it("keeps per-key metadata when a second host refreshes the same pooled row", async () => {
  const hostM4Response = deferredResponse();
  const hostM5SourceResponse = deferredResponse();
  const scopedMachines = [
    machineRow({ id: "host-m4", displayName: "M4", providers: [] }),
    machineRow({
      id: "source:account-pool",
      displayName: "Account Pooler",
      providers: [
        providerRow({
          id: "pool-glm",
          providerId: "glm",
          displayName: "GLM Coding",
          usage: { status: "expired" },
          expiredHint:
            "Put the API token for this profile in /hosts/m4/token (chmod 600), then reload.",
        }),
      ],
    }),
  ];
  const fallbackMachines = [
    machineRow({ id: "host-m5", displayName: "M5", providers: [] }),
    machineRow({
      id: "source:account-pool",
      displayName: "Account Pooler",
      providers: [
        providerRow({
          id: "pool-glm",
          providerId: "glm",
          displayName: "glm",
          usage: { status: "expired" },
          expiredHint: "Sign in to glm again.",
        }),
      ],
    }),
  ];
  const fetchMock = stubAsideFetch(({ machineIds }) => {
    const key = machineIds?.join("\n");
    if (key === "host-m4") return hostM4Response.promise;
    if (key === "host-m5\nsource:account-pool")
      return hostM5SourceResponse.promise;
    return snapshotResponse(scopedMachines);
  });
  const slot = await renderAside({
    threads: [
      asideThread({ id: "thread-current", providerId: "glm" }),
      asideThread({
        id: "thread-child",
        parentThreadId: "thread-current",
        providerId: "glm",
        host: { id: "host-m5", name: "M5" },
      }),
    ],
  });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  hostM4Response.resolve(snapshotResponse(scopedMachines));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  await waitFor(() => expect(slot.getByText("GLM Coding")).toBeTruthy());
  hostM5SourceResponse.resolve(snapshotResponse(fallbackMachines));
  await flush();
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(slot.getByText("GLM Coding")).toBeTruthy();
  expect(
    slot.getByText(
      "Put the API token for this profile in /hosts/m4/token (chmod 600), then reload.",
    ),
  ).toBeTruthy();
  expect(slot.queryByText("Sign in to glm again.")).toBeNull();
});

it("leaves the card store untouched while the aside fetches", async () => {
  const fetchMock = stubAsideFetch(({ force }) =>
    force
      ? snapshotResponse([])
      : snapshotResponse([
          machineRow({
            id: "host-m4",
            displayName: "M4",
            providers: [
              providerRow({
                id: "m4-codex",
                providerId: "codex",
                displayName: "Codex",
                usage: usageOk(33, 2),
              }),
            ],
          }),
        ]),
  );
  const app = await loadPluginApp(() => import("./app"));
  const item = app.experimentalSidebarFooterItems[0];
  if (item?.kind !== "disclosure") throw new Error("missing disclosure");
  const card = renderSlot(
    item,
    { dismiss: vi.fn() },
    { pluginId: "bb--provider-usage" },
  );
  expect(card.getByText("No usage sources available.")).toBeTruthy();
  const registration = firstComposerAside(app);
  const aside = renderSlot(
    registration,
    { threadId: "thread-current", projectId: "project-one" },
    {
      pluginId: "bb--provider-usage",
      sidebarThreads: { threads: [asideThread({ id: "thread-current" })] },
    },
  );
  await waitFor(() => expect(aside.getByText("33%")).toBeTruthy());
  expect(card.getByText("No usage sources available.")).toBeTruthy();
  expect(
    (
      card.getByRole("button", {
        name: "Reload provider usage",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  expect(card.queryByText("Couldn’t refresh usage.")).toBeNull();
  expect(fetchMock).toHaveBeenCalled();
  await aside.unmount();
  await card.unmount();
});

describe("aside refresh cadence", () => {
  function setupCadence(options: {
    respond: (body: FetchBody, call: number) => Response | Promise<Response>;
  }) {
    const fetchMock = stubAsideFetch(options.respond);
    return {
      fetchMock,
      rendered: renderAside({
        threads: [asideThread({ id: "thread-current" })],
      }),
    };
  }

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  }

  it("does not re-request inside CARD_MAX_AGE_MS and refreshes on the tick after it", async () => {
    vi.useFakeTimers();
    const { fetchMock, rendered } = setupCadence({
      respond: () =>
        snapshotResponse([
          machineRow({
            id: "host-m4",
            displayName: "M4",
            providers: [
              providerRow({
                id: "m4-codex",
                providerId: "codex",
                displayName: "Codex",
                usage: usageOk(33, 2),
              }),
            ],
          }),
        ]),
    });
    const slot = await rendered;
    await advance(300);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(59_700);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(asideBodies(requestBodies(fetchMock))).toHaveLength(2);
    await slot.unmount();
  });

  it("re-requests on window focus after CARD_MAX_AGE_MS and skips ticks while hidden", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get");
    const { fetchMock, rendered } = setupCadence({
      respond: () => snapshotResponse([]),
    });
    const slot = await rendered;
    await advance(300);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue("hidden");
    await advance(130_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue("visible");
    window.dispatchEvent(new Event("focus"));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await slot.unmount();
    visibility.mockRestore();
  });

  it("sends once per distinct resetsAt at resetsAt plus 60 seconds with maxAgeMs 0", async () => {
    vi.useFakeTimers();
    const fixedMachines = [
      machineRow({
        id: "host-m4",
        displayName: "M4",
        providers: [
          providerRow({
            id: "m4-codex",
            providerId: "codex",
            displayName: "Codex",
            usage: usageOk(33, 1 / 6),
          }),
        ],
      }),
    ];
    const { fetchMock, rendered } = setupCadence({
      respond: () => snapshotResponse(fixedMachines),
    });
    const slot = await rendered;
    await advance(300);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    let resetBodies: FetchBody[] = [];
    for (let index = 0; index < 10; index += 1) {
      await advance(60_000);
      await flush();
      resetBodies = requestBodies(fetchMock).filter(
        (body) => body.maxAgeMs === 0,
      );
      expect(resetBodies).toEqual([]);
    }
    for (let index = 0; index < 4 && resetBodies.length === 0; index += 1) {
      await advance(60_000);
      await flush();
      resetBodies = requestBodies(fetchMock).filter(
        (body) => body.maxAgeMs === 0,
      );
    }
    expect(resetBodies).toHaveLength(1);
    expect(resetBodies[0]?.machineIds).toEqual(["host-m4"]);
    await advance(60_000);
    await flush();
    await advance(60_000);
    await flush();
    expect(
      requestBodies(fetchMock).filter((body) => body.maxAgeMs === 0),
    ).toHaveLength(1);
    await slot.unmount();
  });

  it("enters backoff on a non-2xx or unparseable response and recovers after FOCUS_MAX_AGE_MS", async () => {
    vi.useFakeTimers();
    const { fetchMock, rendered } = setupCadence({
      respond: (_body, call) =>
        call === 1
          ? new Response("nope", { status: 503 })
          : call === 2
            ? new Response("not json", { status: 200 })
            : snapshotResponse([
                machineRow({
                  id: "host-m4",
                  displayName: "M4",
                  providers: [
                    providerRow({
                      id: "m4-codex",
                      providerId: "codex",
                      displayName: "Codex",
                      usage: usageOk(33, 2),
                    }),
                  ],
                }),
              ]),
    });
    const slot = await rendered;
    await advance(300);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 4; index += 1) {
      await advance(60_000);
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
    for (
      let index = 0;
      index < 3 && fetchMock.mock.calls.length < 2;
      index += 1
    ) {
      await advance(60_000);
      await flush();
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (let index = 0; index < 4; index += 1) {
      await advance(60_000);
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
    for (
      let index = 0;
      index < 3 && fetchMock.mock.calls.length < 3;
      index += 1
    ) {
      await advance(60_000);
      await flush();
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await slot.unmount();
  });

  it("does not enter backoff when the caller aborts on unmount", async () => {
    vi.useFakeTimers();
    const deferred = deferredResponse();
    const { fetchMock, rendered } = setupCadence({
      respond: (_body, call) =>
        call === 1 ? deferred.promise : snapshotResponse([]),
    });
    const slot = await rendered;
    await advance(300);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await slot.unmount();
    await advance(200_000);
    const again = await renderAside({
      threads: [asideThread({ id: "thread-current" })],
    });
    await advance(300);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    deferred.resolve(snapshotResponse([]));
    await flush();
    expect(again.container.textContent).toBe("");
    await again.unmount();
  });

  it("recovers a backed-off key on the next tick after a successful card snapshot", async () => {
    vi.useFakeTimers();
    const { fetchMock, rendered } = setupCadence({
      respond: ({ force }) =>
        force
          ? snapshotResponse([
              machineRow({
                id: "card-host",
                displayName: "Card",
                providers: [],
              }),
            ])
          : new Response("nope", { status: 500 }),
    });
    const slot = await rendered;
    await advance(300);
    await flush();
    const app = await loadPluginApp(() => import("./app"));
    const item = app.experimentalSidebarFooterItems[0];
    if (item?.kind !== "disclosure") throw new Error("missing disclosure");
    const card = renderSlot(
      item,
      { dismiss: vi.fn() },
      { pluginId: "bb--provider-usage" },
    );
    const reload = card.getByRole("button", {
      name: "Reload provider usage",
    }) as HTMLButtonElement;
    expect(reload.disabled).toBe(false);
    fireEvent.click(reload);
    await flush();
    const cardCalls = requestBodies(fetchMock).filter((body) => body.force);
    expect(cardCalls).toHaveLength(1);
    expect(cardCalls[0]?.machineIds).toBeNull();
    await advance(119_700);
    expect(asideBodies(requestBodies(fetchMock))).toHaveLength(1);
    await advance(60_000);
    expect(asideBodies(requestBodies(fetchMock))).toHaveLength(2);
    await slot.unmount();
    await card.unmount();
  });

  it("sends at most one request per FOCUS_MAX_AGE_MS after a machine error, even after resetsAt passes", async () => {
    vi.useFakeTimers();
    const { fetchMock, rendered } = setupCadence({
      respond: () =>
        snapshotResponse([
          machineRow({
            id: "host-m4",
            displayName: "M4",
            error: "boom",
            providers: [
              providerRow({
                id: "m4-codex",
                providerId: "codex",
                displayName: "Codex",
                usage: usageOk(33, 1 / 30),
              }),
            ],
          }),
        ]),
    });
    const slot = await rendered;
    await advance(300);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      slot.getByText("Couldn’t refresh. Showing last update."),
    ).toBeTruthy();
    expect(slot.getByText("33%")).toBeTruthy();
    await advance(259_700);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(100_300);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (let index = 0; index < 4; index += 1) {
      await advance(60_000);
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
    await slot.unmount();
  });
});
