import type { ProjectSource } from "@bb/domain";
import type { SystemEnvironmentProvider } from "@bb/server-contract";
import {
  THREAD_HANDOFF_COMPOSE_SEED_LOCATION_STATE_KEY,
  type ThreadHandoffComposeSeed,
} from "@bb/client-core";
import { describe, expect, it } from "vitest";
import { hasSingleUseRootComposeTargetState } from "./RootComposeView";
import { buildHandoffComposerSeed } from "./root-compose-handoff.fork";
import { resolveRootComposeEffectiveEnvironmentValue } from "./root-compose-environment-selection";

function makeProjectSource(hostId = "host_1"): ProjectSource {
  return {
    id: "src_1",
    projectId: "proj_app",
    type: "local_path",
    hostId,
    path: "/repo",
    isDefault: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeProjectProvider(id: string): SystemEnvironmentProvider {
  return {
    machineProviderId: null,
    id,
    displayName: id,
    description: "Prepare a workspace for this thread.",
    icon: "Folder",
    logoUrl: null,
    pluginId: id,
    acceptsEmptyInputs: true,
    machineAvailability: {},
    availability: null,
    requires: {
      projectCheckout: true,
      gitCheckout: id === "git-worktree",
      gitRemote: false,
      projectless: false,
    },
    inputs: null,
  };
}

describe("resolveRootComposeEffectiveEnvironmentValue", () => {
  const checkoutProvider = makeProjectProvider("project-checkout");
  const worktreeProvider = makeProjectProvider("git-worktree");

  it("retains branch promotion when normalizing a saved selection", () => {
    expect(
      resolveRootComposeEffectiveEnvironmentValue({
        seededReuseEnvironment: null,
        knownHostIds: new Set(["host_1"]),
        environmentSelectionValue: "project-default:branch",
        environmentProviders: [checkoutProvider, worktreeProvider],
        isProjectless: false,
        primaryHostId: "host_1",
        projectSources: [makeProjectSource("host_1")],
        reuseThreadOptions: [],
        reuseThreadOptionsLoading: false,
      }),
    ).toBe("project-default:branch");
  });

  it("keeps a stored explicit checkout selection", () => {
    expect(
      resolveRootComposeEffectiveEnvironmentValue({
        seededReuseEnvironment: null,
        knownHostIds: new Set(["host_1"]),
        environmentSelectionValue: "provider:project-checkout",
        environmentProviders: [checkoutProvider, worktreeProvider],
        isProjectless: false,
        primaryHostId: "host_1",
        projectSources: [makeProjectSource("host_1")],
        reuseThreadOptions: [],
        reuseThreadOptionsLoading: false,
      }),
    ).toBe("provider:project-checkout");
  });

  it("keeps a stored project-default selection only while the fallback preconditions hold", () => {
    expect(
      resolveRootComposeEffectiveEnvironmentValue({
        seededReuseEnvironment: null,
        knownHostIds: new Set(["host_1"]),
        environmentSelectionValue: "project-default",
        environmentProviders: [checkoutProvider, worktreeProvider],
        isProjectless: false,
        primaryHostId: "host_1",
        projectSources: [makeProjectSource("host_1")],
        reuseThreadOptions: [],
        reuseThreadOptionsLoading: false,
      }),
    ).toBe("project-default");

    expect(
      resolveRootComposeEffectiveEnvironmentValue({
        seededReuseEnvironment: null,
        knownHostIds: new Set(["host_1", "host_2"]),
        environmentSelectionValue: "project-default",
        environmentProviders: [checkoutProvider],
        isProjectless: false,
        primaryHostId: "host_1",
        projectSources: [makeProjectSource("host_2")],
        reuseThreadOptions: [],
        reuseThreadOptionsLoading: false,
      }),
    ).toBe("");
  });
});

describe("buildHandoffComposerSeed", () => {
  const handoffSeed: ThreadHandoffComposeSeed = {
    draft: {
      text: "Continue from @thread:thr_plan",
      mentions: [],
      attachments: [],
    },
    environmentId: "env_plan",
    model: "claude-opus-5",
    permissionMode: "auto",
    projectId: "proj_plan",
    providerId: "claude-code",
    reasoningLevel: "high",
    serviceTier: undefined,
    sourceThreadId: "thr_plan",
    sourceThreadTitle: "Plan",
  };

  it("reuses the source environment while the source project is selected", () => {
    expect(buildHandoffComposerSeed(handoffSeed, "proj_plan")).toEqual({
      providerId: "claude-code",
      model: "claude-opus-5",
      reasoningLevel: "high",
      serviceTier: undefined,
      permissionMode: "auto",
      environment: { type: "reuse", environmentId: "env_plan" },
    });
  });

  it("keeps the execution but lets another project choose its environment", () => {
    const seed = buildHandoffComposerSeed(handoffSeed, "proj_work");
    expect(seed.environment).toBeUndefined();
    expect(seed).toMatchObject({
      providerId: "claude-code",
      model: "claude-opus-5",
      permissionMode: "auto",
    });
  });

  it("seeds no environment when the source thread had none", () => {
    expect(
      buildHandoffComposerSeed(
        { ...handoffSeed, environmentId: null },
        "proj_plan",
      ).environment,
    ).toBeUndefined();
  });

  it("treats a handoff seed as single-use location state", () => {
    expect(
      hasSingleUseRootComposeTargetState({
        [THREAD_HANDOFF_COMPOSE_SEED_LOCATION_STATE_KEY]: handoffSeed,
      }),
    ).toBe(true);
    expect(
      hasSingleUseRootComposeTargetState({
        [THREAD_HANDOFF_COMPOSE_SEED_LOCATION_STATE_KEY]: {
          ...handoffSeed,
          model: "",
        },
      }),
    ).toBe(false);
  });
});

describe("hasSingleUseRootComposeTargetState", () => {
  it("recognizes handoff compose state as a single-use target", () => {
    expect(
      hasSingleUseRootComposeTargetState({
        threadHandoffComposeSeed: {
          draft: {
            text: "Continue from @thread:thr_source",
            mentions: [
              {
                start: 14,
                end: 32,
                resource: {
                  kind: "thread",
                  projectId: "proj_source",
                  threadId: "thr_source",
                  label: "Source thread",
                },
              },
            ],
            attachments: [],
          },
          environmentId: "env_source",
          model: "test-model",
          permissionMode: "auto",
          projectId: "proj_source",
          providerId: "test-provider",
          reasoningLevel: "high",
          serviceTier: undefined,
          sourceThreadId: "thr_source",
          sourceThreadTitle: "Source thread",
        },
      }),
    ).toBe(true);
  });

  it("leaves ordinary malformed route state unconsumed", () => {
    expect(
      hasSingleUseRootComposeTargetState({
        threadHandoffComposeSeed: { sourceThreadId: "thr_source" },
      }),
    ).toBe(false);
  });
});
