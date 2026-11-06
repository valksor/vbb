import { describe, expect, it } from "vitest";
import * as contract from "../src/index.js";

describe("server-contract canonical schemas", () => {
  it("parses local maintenance acquisition and status payloads", () => {
    expect(
      contract.maintenanceAcquireRequestSchema.parse({
        operationId: "update-1",
        ownerSecret: "secret",
        reason: "VPS update",
        ttlMs: 60_000,
      }),
    ).toMatchObject({ operationId: "update-1", ttlMs: 60_000 });
    expect(
      contract.maintenanceStatusResponseSchema.parse({
        lease: null,
        barrier: [],
        activity: { activeByKind: {} },
      }),
    ).toEqual({
      lease: null,
      barrier: [],
      activity: { activeByKind: {} },
    });
    expect(
      contract.maintenanceIdentityResponseSchema.parse({
        service: "bb-maintenance",
        protocolVersion: 2,
        releaseIdentity: "/srv/releases/abc123",
        connectedHostIds: ["host-1"],
      }),
    ).toEqual({
      service: "bb-maintenance",
      protocolVersion: 2,
      releaseIdentity: "/srv/releases/abc123",
      connectedHostIds: ["host-1"],
    });
  });
});

describe("server-contract canonical schemas", () => {
  it("parses request contracts", () => {
    expect(
      contract.threadListResponseSchema.parse([
        {
          id: "thr_123",
          projectId: "proj_123",
          environmentId: null,
          providerId: "codex",
          title: "Pending thread",
          titleFallback: "Pending thread",
          sectionId: null,
          status: "idle",
          parentThreadId: null,
          sourceThreadId: null,
          lifecycleOwnerThreadId: null,
          originKind: null,
          originPluginId: null,
          visibility: "visible",
          parentNotifications: "auto",
          worktreePromotion: "declined",
          promotionTarget: "worktree",
          archivedAt: null,
          pinnedAt: null,
          pinSortKey: null,
          deletedAt: null,
          lastReadAt: null,
          latestAttentionAt: 2,
          createdAt: 1,
          updatedAt: 2,
          runtime: {
            displayStatus: "idle",
          },
          activity: {
            activeWorkflowCount: 0,
            activeBackgroundAgentCount: 0,
            activeBackgroundCommandCount: 0,
            activePlanModeCount: 0,
            activeGoalCount: 0,
          },
          hasPendingInteraction: true,
          pendingInteractionKind: "approval",
          environmentHostId: "host_123",
          environmentName: null,
          environmentBranchName: "bb/test",
          environmentPath: null,
          environmentProviderId: "git-worktree",
          environmentIsWorktree: true,
          environmentWorkspaceDisplayKind: "managed-worktree",
          queuedWork: "none",
        },
      ]),
    ).toMatchObject([
      {
        id: "thr_123",
        lifecycleOwnerThreadId: null,
        hasPendingInteraction: true,
        pendingInteractionKind: "approval",
        environmentHostId: "host_123",
        environmentName: null,
        environmentBranchName: "bb/test",
        environmentPath: null,
        environmentProviderId: "git-worktree",
        environmentIsWorktree: true,
        environmentWorkspaceDisplayKind: "managed-worktree",
        queuedWork: "none",
      },
    ]);
  });
});
