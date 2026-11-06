import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { internalAuthHeaders } from "../helpers/commands.js";
import {
  PLUGIN_TOOL_CALL_AWAITING_USER_RESULT_TEXT,
} from "../../src/services/plugins/plugin-tool-calls.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedIdleProviderThread(harness: TestAppHarness, value: number) {
  const { host, session } = seedHostSession(harness.deps, {
    id: `host-detached-tool-${value}`,
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: `/tmp/detached-tool-${value}`,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: `/tmp/detached-tool-${value}`,
    status: "ready",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "idle",
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId: `provider-detached-tool-${value}`,
    threadId: thread.id,
  });
  return { session, thread };
}

async function writeInputPlugin(rootPath: string): Promise<string> {
  const pluginPath = join(rootPath, "bb-plugin-held-input");
  await mkdir(pluginPath, { recursive: true });
  await writeFile(
    join(pluginPath, "package.json"),
    JSON.stringify({
      name: "bb-plugin-held-input",
      version: "0.1.0",
      bb: {
        name: "Held input fixture",
        description: "Held input fixture.",
        branding: { icon: "MessageQuestion" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(
    join(pluginPath, "server.ts"),
    `
      export default function plugin(bb: any) {
        for (const [name, experimental_holdToolCall] of [
          ["held_input", true],
          ["detached_input", false],
        ]) {
          bb.agents.registerTool({
            name,
            description: "Request input",
            parameters: { type: "object" },
            async execute(_input: unknown, ctx: any) {
              const result = await bb.ui.requestInput(
                {
                  threadId: ctx.threadId,
                  rendererId: "fixture-input",
                  title: "Input",
                  payload: {},
                },
                { signal: ctx.signal, experimental_holdToolCall },
              );
              return result.outcome === "submitted" ? "submitted" : "cancelled";
            },
          });
        }
      }
    `,
  );
  return pluginPath;
}

describe("plugin tool calls that outlive their round trip", () => {
  it("keeps held requestInput calls open while default forms still detach", async () => {
    await withTestHarness(async (harness) => {
      const fixturePath = await mkdtemp(join(tmpdir(), "bb-held-input-"));
      try {
        const pluginPath = await writeInputPlugin(fixturePath);
        await harness.pluginService.installPath(pluginPath);
        const { session, thread } = seedIdleProviderThread(harness, 4);
        seedTurnStarted(harness.deps, {
          threadId: thread.id,
          turnId: "turn-held-input",
          providerThreadId: "provider-held-input",
        });

        let heldBodySettled = false;
        const heldResult = Promise.resolve(
          harness.app.request("/internal/session/tool-call", {
            method: "POST",
            headers: internalAuthHeaders(harness),
            body: JSON.stringify({
              sessionId: session.id,
              threadId: thread.id,
              providerThreadId: "provider-held-input",
              turnId: "turn-held-input",
              callId: "held-call",
              tool: "held_input",
            }),
          }),
        )
          .then((response) => response.json())
          .then((result) => {
            heldBodySettled = true;
            return result;
          });
        await vi.waitFor(() =>
          expect(
            harness.deps.pendingInteractions.listPendingThreadInteractions(
              thread.id,
            ),
          ).toHaveLength(1),
        );
        const [held] =
          harness.deps.pendingInteractions.listPendingThreadInteractions(
            thread.id,
          );
        expect(held?.turnId).toBe("turn-held-input");
        await Promise.resolve();
        expect(heldBodySettled).toBe(false);

        const submitHeld = await harness.app.request(
          `/api/v1/threads/${thread.id}/interactions/${held!.id}/respond`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ value: "answer" }),
          },
        );
        expect(submitHeld.status).toBe(200);
        await expect(heldResult).resolves.toMatchObject({ success: true });

        const detachedResponse = await harness.app.request(
          "/internal/session/tool-call",
          {
            method: "POST",
            headers: internalAuthHeaders(harness),
            body: JSON.stringify({
              sessionId: session.id,
              threadId: thread.id,
              providerThreadId: "provider-held-input",
              turnId: "turn-held-input",
              callId: "detached-call",
              tool: "detached_input",
            }),
          },
        );
        await expect(detachedResponse.json()).resolves.toMatchObject({
          success: true,
          contentItems: [
            {
              text: PLUGIN_TOOL_CALL_AWAITING_USER_RESULT_TEXT,
              type: "inputText",
            },
          ],
        });
        const [detached] =
          harness.deps.pendingInteractions.listPendingThreadInteractions(
            thread.id,
          );
        expect(detached?.turnId).toBeNull();
        harness.deps.pendingInteractions.cancelPluginInteraction({
          interactionId: detached!.id,
          threadId: thread.id,
          reason: "user",
        });
      } finally {
        await rm(fixturePath, { recursive: true, force: true });
      }
    });
  });
});
