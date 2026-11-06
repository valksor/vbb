import { acquireWorkQuiesceLease, listOpenWorkAdmissions } from "@bb/db";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callPluginHostRpc } from "../../src/services/plugins/plugin-host-rpc.js";
import { callHostOnlineRpc } from "../../src/services/hosts/online-rpc.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { stubHostArtifact } from "../helpers/provider-registry.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const retryablePluginContract = defineRpcContract({
  read: {
    experimental_retryable: true,
    input: z.object({ id: z.string() }),
    output: z.object({ path: z.string() }),
  },
});

describe("host online RPC retry semantics", () => {
  it("records and rejects execution-start RPC admission after quiesce commits", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-online-rpc-quiesced",
      });
      const send = vi.fn();
      harness.hub.unregisterDaemon(session.id);
      harness.hub.registerDaemon(session.id, host.id, { close() {}, send });
      send.mockClear();
      acquireWorkQuiesceLease(harness.db, {
        operationId: "update-1",
        ownerSecretHash: "owner-hash",
        reason: "VPS update",
        now: Date.now(),
        expiresAt: Date.now() + 60_000,
      });

      await expect(
        callHostOnlineRpc(harness.deps, {
          hostId: host.id,
          timeoutMs: 1_000,
          command: {
            type: "environment.hook.run",
            contributedEnv: [],
            resumeOnly: false,
            operationId: "hook-1",
            path: "/tmp/env",
            kind: "setup",
            timeoutMs: 1_000,
          },
        }),
      ).rejects.toMatchObject({
        status: 503,
        body: { code: "work_quiesced", retryable: true },
      });
      expect(send).not.toHaveBeenCalled();
    });
  });

  it("holds one admission across a retried plugin call and settles it once", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const callIds: string[] = [];
      const cancelled: string[] = [];
      let openAdmissionsAtRetry: ReturnType<typeof listOpenWorkAdmissions> = [];
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: async (request) => {
          if (request.command.type === "plugin.host.cancel") {
            cancelled.push(request.command.callId);
            return { ok: true, result: { cancelled: true } };
          }
          if (request.command.type !== "plugin.host.call")
            throw new Error(`Unexpected RPC ${request.command.type}`);
          callIds.push(request.command.callId);
          if (callIds.length === 1) return new Promise(() => {});
          openAdmissionsAtRetry = listOpenWorkAdmissions(harness.db);
          return { ok: true, result: { output: { path: "read" } } };
        },
      });

      await expect(
        callPluginHostRpc(harness.deps, {
          pluginId: "environment-test",
          contract: retryablePluginContract,
          method: "read",
          input: { id: "env-1" },
          hostId: host.id,
          timeoutMs: 1_000,
          artifact: stubHostArtifact("environment-test"),
        }),
      ).resolves.toEqual({ path: "read" });

      expect(callIds).toHaveLength(2);
      expect(callIds[1]).not.toBe(callIds[0]);
      expect(openAdmissionsAtRetry).toHaveLength(1);
      await vi.waitFor(() => expect(cancelled).toEqual([callIds[0]]));
      expect(listOpenWorkAdmissions(harness.db)).toEqual([]);
      responder.unregister();
    });
  });

  it("refuses a retryable plugin call while a quiesce lease is held", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: async (request) => {
          throw new Error(`Unexpected RPC ${request.command.type}`);
        },
      });
      acquireWorkQuiesceLease(harness.db, {
        operationId: "update-1",
        ownerSecretHash: "owner-hash",
        reason: "VPS update",
        now: Date.now(),
        expiresAt: Date.now() + 60_000,
      });

      await expect(
        callPluginHostRpc(harness.deps, {
          pluginId: "environment-test",
          contract: retryablePluginContract,
          method: "read",
          input: { id: "env-1" },
          hostId: host.id,
          timeoutMs: 1_000,
          artifact: stubHostArtifact("environment-test"),
        }),
      ).rejects.toMatchObject({
        status: 503,
        body: { code: "work_quiesced", retryable: true },
      });
      expect(
        responder.requests.filter(
          (request) => request.command.type === "plugin.host.call",
        ),
      ).toEqual([]);
      responder.unregister();
    });
  });
});
