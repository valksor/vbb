import type { ProjectSource } from "@bb/domain";
import type { SystemEnvironmentProvider } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
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
