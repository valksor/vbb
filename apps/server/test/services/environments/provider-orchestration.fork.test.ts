import { appendThreadProvisioningEvent } from "../../../src/services/threads/thread-events.js";
import { requestThreadStopForCurrentState } from "../../../src/services/threads/thread-lifecycle.js";
import { prepareProviderEnvironment } from "../../../src/services/threads/thread-environment-placement.js";
import { recordProvisionedEnvironmentWorkspace } from "@bb/db/internal-environment-lifecycle";
import { encodeClientTurnRequestIdNumber } from "@bb/domain";
import {
  saveThreadProvisionContext,
  createThreadStartup,
} from "../../../src/services/threads/thread-startup-store.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createEnvironment,
  environments,
  getEnvironment,
  getPreparingEnvironment,
  getThread,
} from "@bb/db";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import type { PluginEnvironmentProviderDeclaration } from "@get-bb/plugin-sdk";
import { validatePluginEnvironmentProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import {
  markProviderEnvironmentAttached,
  type ProviderOperationContext,
} from "../../../src/services/environments/environment-engine.js";
import { setPluginEnvironmentProviderBridge } from "../../../src/services/plugins/plugin-environment-provider-registry.js";
import { toThreadResponseFromThread } from "../../../src/services/threads/thread-runtime-display.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../../helpers/seed.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

function setup(
  harness: TestAppHarness,
  overrides: Partial<PluginEnvironmentProviderDeclaration> = {},
) {
  const { host, session } = seedHostSession(harness.deps, { id: "host_test" });
  const { project, source } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/tmp/project",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    status: "starting",
  });
  const record = {
    pluginId: "test",
    provider: validatePluginEnvironmentProviderDeclaration({
      id: "test-provider",
      displayName: "Test",
      description: "Prepare a workspace for this thread.",
      icon: "Folder",
      create: async () => ({
        status: "created",
        path: `/tmp/${thread.id}`,
        ownsPath: true,
      }),
      remove: async () => ({ status: "removed" }),
      ...overrides,
    }),
  };
  setPluginEnvironmentProviderBridge({
    listEnvironmentProviders: () => [record],
    getEnvironmentProvider: (id) =>
      id === record.provider.id ? record : undefined,
    invokeProvider: async (_id, _label, run) => ({
      ok: true,
      value: await run(),
    }),
    decisionTimeoutMs: 10_000,
  });
  const context: ProviderOperationContext = {
    thread: toThreadResponseFromThread(harness.deps, { thread }),
    project,
    host: makeHost({ id: host.id, name: host.name }),
    machine: { type: "existing", hostId: host.id },
    projectCheckout: null,
    gitRemote: null,
    inputs: null,
    suggestedBranchName: "bb/test",
    environment: null,
  };
  let lastEnvironmentId: string | null = null;
  const row = () => {
    const attachedId = getThread(harness.db, thread.id)?.environmentId;
    const value =
      getPreparingEnvironment(harness.db, thread.id) ??
      (attachedId
        ? getEnvironment(harness.db, attachedId)
        : lastEnvironmentId === null
          ? null
          : getEnvironment(harness.db, lastEnvironmentId));
    if (value === null) throw new Error("Missing preparing environment");
    lastEnvironmentId = value.id;
    return value;
  };
  const ask = () => prepareProviderEnvironment(harness.deps, record, context);
  const settled = async () =>
    expect.poll(() => row().status).not.toBe("creating");
  const attach = () => {
    const prepared = row();
    if (prepared.hostId === null || prepared.path === null) {
      throw new Error("Environment is not ready");
    }
    const environment = getEnvironment(harness.db, prepared.id)!;
    harness.db
      .update(environments)
      .set({ status: "ready" })
      .where(eq(environments.id, environment.id))
      .run();
    markProviderEnvironmentAttached(harness.db, thread.id, environment.id);
    recordProvisionedEnvironmentWorkspace(
      harness.db,
      harness.hub,
      environment.id,
      {
        path: prepared.path,
        isGitRepo: false,
        isWorktree: false,
        branchName: null,
        defaultBranch: null,
      },
    );
    return environment.id;
  };
  return {
    ask,
    attach,
    context,
    host,
    session,
    record,
    row,
    settled,
    source,
    thread,
  };
}

function saveProviderStartup(
  harness: TestAppHarness,
  fixture: ReturnType<typeof setup>,
) {
  const context = createThreadStartup({
    initiator: "user",
    clientRequestId: encodeClientTurnRequestIdNumber({ value: 1 }),
    environmentIntent: {
      type: "provider",
      environmentProviderId: fixture.record.provider.id,
      machine: fixture.context.machine,
      inputs: null,
      selectionResolved: true,
    },
    execution: {
      model: "gpt-5",
      serviceTier: "default",
      reasoningLevel: "medium",
      permissionMode: "accept-edits",
      source: "client/turn/requested",
    },
    fork: null,
    input: [],
    titleProvided: true,
    seedWithoutRun: false,
  });
  context.state.provisionEventSequence = appendThreadProvisioningEvent(
    harness.deps,
    {
      threadId: fixture.thread.id,
      environmentId: null,
      provisioningId: context.state.provisioningId,
      status: "active",
      entries: [
        {
          type: "step",
          key: "workspace-started",
          text: "Preparing workspace",
          status: "started",
        },
      ],
    },
  );
  saveThreadProvisionContext({
    db: harness.db,
    replace: true,
    threadId: fixture.thread.id,
    context,
  });
}

afterEach(() => {
  vi.useRealTimers();
  setPluginEnvironmentProviderBridge(undefined);
});

it.each(["ready", "provisioning"] as const)(
  "releases an unshared %s workspace it adopted when its owner cancels",
  async (adoptedStatus) => {
    await withTestHarness(async (harness) => {
      const remove = vi.fn(async () => ({ status: "removed" as const }));
      const fixture = setup(harness, {
        create: async () => ({
          status: "created",
          path: "/tmp/adopted-unshared",
          ownsPath: false,
        }),
        remove,
      });
      const adopted = createEnvironment(harness.db, harness.hub, {
        projectId: fixture.context.project.id,
        hostId: fixture.host.id,
        path: "/tmp/adopted-unshared",
        status: adoptedStatus,
        providerOwnsPath: false,
      });
      fixture.ask();
      await expect
        .poll(() => getPreparingEnvironment(harness.db, fixture.thread.id)?.id)
        .toBe(adopted.id);
      saveProviderStartup(harness, fixture);
      requestThreadStopForCurrentState(harness.deps, fixture.thread, null);

      await expect
        .poll(() => getEnvironment(harness.db, adopted.id)?.ownerThreadId)
        .toBeNull();
      expect(getEnvironment(harness.db, adopted.id)).toMatchObject({
        status: adoptedStatus,
        path: "/tmp/adopted-unshared",
        claimPath: null,
        teardownStatus: null,
        retireAt: null,
        adoptedFromStatus: null,
      });
      expect(remove).not.toHaveBeenCalled();
    });
  },
);

it("clears the adopted marker once the environment attaches", async () => {
  await withTestHarness(async (harness) => {
    const fixture = setup(harness, {
      create: async () => ({
        status: "created",
        path: "/tmp/adopted-attach",
        ownsPath: false,
      }),
    });
    const adopted = createEnvironment(harness.db, harness.hub, {
      projectId: fixture.context.project.id,
      hostId: fixture.host.id,
      path: "/tmp/adopted-attach",
      status: "ready",
      providerOwnsPath: false,
    });
    fixture.ask();
    await expect
      .poll(() => getPreparingEnvironment(harness.db, fixture.thread.id)?.id)
      .toBe(adopted.id);
    expect(getEnvironment(harness.db, adopted.id)?.adoptedFromStatus).toBe(
      "ready",
    );

    fixture.attach();

    expect(
      getEnvironment(harness.db, adopted.id)?.adoptedFromStatus,
    ).toBeNull();
  });
});

describe("existing-path provider selection", () => {
  it("keeps an adopted environment when provisioning is asked again", async () =>
    withTestHarness(async (harness) => {
      const fixture = setup(harness, {
        create: async () => ({
          status: "created",
          path: "/tmp/existing",
          ownsPath: false,
        }),
        policy: { retireGraceMs: 0 },
      });
      const existing = seedEnvironment(harness.deps, {
        projectId: fixture.context.project.id,
        hostId: fixture.host.id,
        path: "/tmp/existing",
        environmentProviderId: fixture.record.provider.id,
        environmentProviderPluginId: "test",
        environmentProviderInstanceKey: "original-key",
        environmentProviderSelection: {
          machine: { type: "existing", hostId: fixture.host.id },
          inputs: { path: "/tmp/existing" },
        },
      });
      fixture.ask();
      await fixture.settled();
      expect(fixture.row().id).toBe(existing.id);

      expect(fixture.ask()).toMatchObject({ action: "ready" });
      expect(fixture.row()).toMatchObject({
        id: existing.id,
        path: "/tmp/existing",
        teardownStatus: null,
      });
      expect(fixture.row().status).not.toBe("destroyed");
    }));
});
