import {
  pluginInteractionDescriptionSchema,
  threadScope,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  hostDaemonCommandSchema,
  hostDaemonEventBatchRequestSchema,
} from "../src/index.js";

describe("host-daemon command schemas", () => {
  it("round-trips lease-scoped work barrier commands", () => {
    expect(
      hostDaemonCommandSchema.parse({
        type: "work.quiesce",
        operationId: "update-1",
        expiresAt: 1_700_000_060_000,
      }),
    ).toEqual({
      type: "work.quiesce",
      operationId: "update-1",
      expiresAt: 1_700_000_060_000,
    });
    expect(
      hostDaemonCommandSchema.parse({
        type: "work.seal",
        operationId: "update-1",
      }),
    ).toEqual({ type: "work.seal", operationId: "update-1" });
    expect(
      hostDaemonCommandSchema.parse({
        type: "work.unquiesce",
        operationId: "update-1",
      }),
    ).toEqual({ type: "work.unquiesce", operationId: "update-1" });
  });

  it("parses fork interactive resolutions", () => {
    expect(
      hostDaemonCommandSchema.parse({
        type: "interactive.resolve",
        environmentId: "env_123",
        threadId: "thr_123",
        interactionId: "pint_124",
        providerId: "codex",
        providerThreadId: "provider-thread-123",
        providerRequestId: "request-124",
        resolution: {
          decision: "deny",
          message: "held for review",
        },
      }),
    ).toMatchObject({
      type: "interactive.resolve",
      interactionId: "pint_124",
      resolution: {
        decision: "deny",
        message: "held for review",
      },
    });

    const pluginSubmittedCommand = {
      type: "interactive.resolve",
      environmentId: "env_123",
      threadId: "thr_123",
      interactionId: "pint_125",
      providerId: "codex",
      providerThreadId: "provider-thread-123",
      providerRequestId: "request-125",
    } as const;
    expect(
      hostDaemonCommandSchema.parse({
        ...pluginSubmittedCommand,
        resolution: { kind: "plugin_submitted" },
      }),
    ).toMatchObject({ resolution: { kind: "plugin_submitted" } });
    expect(
      hostDaemonCommandSchema.parse({
        ...pluginSubmittedCommand,
        resolution: { kind: "plugin_submitted", answeredVia: "app" },
      }),
    ).toMatchObject({
      resolution: { kind: "plugin_submitted", answeredVia: "app" },
    });
    expect(
      hostDaemonCommandSchema.safeParse({
        ...pluginSubmittedCommand,
        resolution: { kind: "plugin_submitted", answeredVia: "desktop" },
      }).success,
    ).toBe(false);
  });

  it("keeps the pinned protocol267 plugin-resolution parser compatible with answer origin", () => {
    const legacyPluginSubmittedResolutionAtD0 = z.object({
      kind: z.literal("plugin_submitted"),
      description: pluginInteractionDescriptionSchema.optional(),
    });
    const legacyPluginResolveCommandAtD0 = z
      .object({
        environmentId: z.string().min(1),
        threadId: z.string().min(1),
        type: z.literal("interactive.resolve"),
        interactionId: z.string().min(1),
        providerId: z.string().min(1),
        providerThreadId: z.string().min(1),
        providerRequestId: z.string().min(1),
        resolution: legacyPluginSubmittedResolutionAtD0,
      })
      .strict();
    const target = {
      type: "interactive.resolve",
      environmentId: "env_123",
      threadId: "thr_123",
      interactionId: "pint_125",
      providerId: "codex",
      providerThreadId: "provider-thread-123",
      providerRequestId: "request-125",
    } as const;
    const description = { title: "Submitted" };
    for (const answeredVia of ["app", "api"] as const) {
      const parsed = legacyPluginResolveCommandAtD0.parse({
        ...target,
        resolution: { kind: "plugin_submitted", description, answeredVia },
      });
      expect(parsed.resolution).toEqual({
        kind: "plugin_submitted",
        description,
      });
      expect(parsed.resolution).not.toHaveProperty("answeredVia");
    }
    expect(
      legacyPluginResolveCommandAtD0.parse({
        ...target,
        resolution: { kind: "plugin_submitted" },
      }).resolution,
    ).toEqual({ kind: "plugin_submitted" });
  });

  it("parses fork thread/execution/reported events", () => {
    expect(
      hostDaemonEventBatchRequestSchema.parse({
        sessionId: "session_123",
        eventGroups: [
          {
            threadId: "thr_123",
            events: [
              {
                type: "thread/execution/reported",
                threadId: "thr_123",
                providerThreadId: "provider-thread-123",
                scope: threadScope(),
                execution: {
                  model: "claude-opus-4-6",
                  reasoningLevel: null,
                  permissionMode: null,
                  serviceTier: null,
                },
              },
            ],
          },
        ],
      }),
    ).toMatchObject({
      eventGroups: [{ events: [{ type: "thread/execution/reported" }] }],
    });

    expect(() =>
      hostDaemonEventBatchRequestSchema.parse({
        sessionId: "session_123",
        eventGroups: [
          {
            threadId: "thr_123",
            events: [
              {
                type: "thread/execution/reported",
                threadId: "thr_123",
                providerThreadId: "provider-thread-123",
                scope: threadScope(),
                execution: {
                  model: "",
                  reasoningLevel: null,
                  permissionMode: null,
                  serviceTier: null,
                },
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });
});
