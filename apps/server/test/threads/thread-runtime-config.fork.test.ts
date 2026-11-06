import { describe, expect, it } from "vitest";
import { resolveThreadRuntimeCommandConfig } from "../../src/services/threads/thread-runtime-config.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("thread runtime config", () => {
  it("offers branch promotion instead of worktree promotion for branch selection", async () => {
    await withTestHarness(async (harness) => {
      const hostId = "host-declined-promotion-runtime";
      seedHostSession(harness.deps, { id: hostId });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId,
        path: "/tmp/declined-promotion-project-root",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId,
        projectId: project.id,
        path: "/tmp/declined-promotion-project-root",
        environmentProviderId: "project-checkout",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        worktreePromotion: "armed",
        promotionTarget: "branch",
      });

      const runtimeConfig = await resolveThreadRuntimeCommandConfig(
        harness.deps,
        {
          thread,
          model: "test-model",
          environment: {
            hostId: environment.hostId,
            id: environment.id,
            path: environment.path,
            status: environment.status,
          },
        },
      );

      expect(runtimeConfig.dynamicTools.map((tool) => tool.name)).toEqual([
        "bb_enter_branch",
        "bb_keep_checkout",
        "update_environment_directory",
      ]);
      expect(runtimeConfig.instructions).not.toContain("bb_enter_worktree");
      expect(runtimeConfig.instructions).toContain("bb_enter_branch");
      expect(runtimeConfig.instructions).toContain(
        "Staying in the checkout alone does not decline branching",
      );
    });
  });

  it("omits lazy worktree promotion once the thread declined it", async () => {
    await withTestHarness(async (harness) => {
      const hostId = "host-declined-promotion-runtime";
      seedHostSession(harness.deps, { id: hostId });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId,
        path: "/tmp/declined-promotion-project-root",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId,
        projectId: project.id,
        path: "/tmp/declined-promotion-project-root",
        environmentProviderId: "project-checkout",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        worktreePromotion: "declined",
      });

      const runtimeConfig = await resolveThreadRuntimeCommandConfig(
        harness.deps,
        {
          thread,
          model: "test-model",
          environment: {
            hostId: environment.hostId,
            id: environment.id,
            path: environment.path,
            status: environment.status,
          },
        },
      );

      expect(runtimeConfig.dynamicTools.map((tool) => tool.name)).toEqual([
        "update_environment_directory",
      ]);
      expect(runtimeConfig.instructions).not.toContain("bb_enter_worktree");
      expect(runtimeConfig.instructions).not.toContain("bb_keep_checkout");
    });
  });

  it("omits lazy worktree promotion inside a provider-owned worktree", async () => {
    await withTestHarness(async (harness) => {
      const hostId = "host-managed-worktree-runtime";
      seedHostSession(harness.deps, { id: hostId });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId,
        path: "/tmp/managed-worktree-project-root",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId,
        projectId: project.id,
        path: "/tmp/managed-worktree-runtime",
        providerOwnsPath: true,
        environmentProviderId: "git-worktree",
        environmentProviderPluginId: "environment-git-worktree",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      const runtimeConfig = await resolveThreadRuntimeCommandConfig(
        harness.deps,
        {
          thread,
          model: "test-model",
          environment: {
            hostId: environment.hostId,
            id: environment.id,
            path: environment.path,
            status: environment.status,
          },
        },
      );

      expect(runtimeConfig.dynamicTools.map((tool) => tool.name)).toEqual([
        "update_environment_directory",
      ]);
      expect(runtimeConfig.instructions).not.toContain("bb_enter_worktree");
    });
  });

  it("omits lazy worktree promotion for a non-Git checkout", async () => {
    await withTestHarness(async (harness) => {
      const hostId = "host-non-git-runtime";
      seedHostSession(harness.deps, { id: hostId });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId,
        path: "/tmp/non-git-project-root",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId,
        projectId: project.id,
        path: "/tmp/non-git-project-root",
        environmentProviderId: "project-checkout",
        isGitRepo: false,
        branchName: null,
        defaultBranch: null,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      const runtimeConfig = await resolveThreadRuntimeCommandConfig(
        harness.deps,
        {
          thread,
          model: "test-model",
          environment: {
            hostId: environment.hostId,
            id: environment.id,
            path: environment.path,
            status: environment.status,
          },
        },
      );

      expect(runtimeConfig.dynamicTools.map((tool) => tool.name)).toEqual([
        "update_environment_directory",
      ]);
      expect(runtimeConfig.instructions).not.toContain("bb_enter_worktree");
    });
  });
});
