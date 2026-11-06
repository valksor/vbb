import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getPendingInteraction } from "@bb/db";
import type { JsonValue } from "@bb/domain";
import { toPendingInteraction } from "../../src/services/interactions/pending-interaction-serialization.js";
import type { AppDeps } from "../../src/types.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const APP_SURFACE_HEADER = "x-bb-app-surface";
const FORM_ANSWER = { approved: true };

function seedFormThread(deps: AppDeps, suffix: string) {
  const { host } = seedHostSession(deps, {
    id: `host-app-answer-${suffix}`,
  });
  const { project } = seedProjectWithSource(deps, { hostId: host.id });
  const environment = seedEnvironment(deps, {
    hostId: host.id,
    projectId: project.id,
  });
  return seedThread(deps, {
    projectId: project.id,
    environmentId: environment.id,
  });
}

function requestForm(
  deps: AppDeps,
  args: {
    threadId: string;
    requireAppAnswer: boolean;
    describeSubmission?: Parameters<
      AppDeps["pendingInteractions"]["requestPluginInteraction"]
    >[0]["describeSubmission"];
  },
) {
  const pending = deps.pendingInteractions.requestPluginInteraction({
    pluginId: "auto-review",
    threadId: args.threadId,
    rendererId: "plan-approval",
    title: "Approve plan",
    payload: { plan: "Do the thing" },
    presentation: {
      label: { pending: "Waiting for plan", completed: "Plan answered" },
      icon: { glyph: "Toolbox" },
    },
    describeSubmission: args.describeSubmission ?? null,
    timeoutMs: 10_000,
    owner: { pluginId: "auto-review" },
    ...(args.requireAppAnswer ? { requireAppAnswer: true } : {}),
  });
  const [interaction] = deps.pendingInteractions.listPendingThreadInteractions(
    args.threadId,
  );
  return { pending, interactionId: interaction!.id };
}

function respond(
  harness: TestAppHarness,
  args: { threadId: string; interactionId: string; surface?: string },
) {
  return harness.app.request(
    `/api/v1/threads/${args.threadId}/interactions/${args.interactionId}/respond`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(args.surface === undefined
          ? {}
          : { [APP_SURFACE_HEADER]: args.surface }),
      },
      body: JSON.stringify({ value: FORM_ANSWER }),
    },
  );
}

function storedStatus(deps: AppDeps, interactionId: string) {
  return toPendingInteraction(getPendingInteraction(deps.db, interactionId)!)
    .status;
}

async function expectRefused(response: Response) {
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    code: "app_answer_required",
    message: "This form must be answered in the bb app.",
  });
}

describe("plugin forms that require an app answer", () => {
  it.each([
    ["no header", undefined],
    ["an explicit api header", "api"],
    ["an unknown header value", "terminal-agent"],
  ])("refuses %s and leaves the form pending", async (_name, surface) => {
    await withTestHarness(async (harness) => {
      const thread = seedFormThread(harness.deps, `refuse-${surface}`);
      const { pending, interactionId } = requestForm(harness.deps, {
        threadId: thread.id,
        requireAppAnswer: true,
      });
      const settled = vi.fn();
      void pending.then(settled);

      await expectRefused(
        await respond(harness, {
          threadId: thread.id,
          interactionId,
          ...(surface === undefined ? {} : { surface }),
        }),
      );

      expect(storedStatus(harness.deps, interactionId)).toBe("pending");
      expect(settled).not.toHaveBeenCalled();

      const answered = await respond(harness, {
        threadId: thread.id,
        interactionId,
        surface: "desktop",
      });
      expect(answered.status).toBe(200);
      await expect(pending).resolves.toEqual({
        outcome: "submitted",
        value: FORM_ANSWER,
      });
    });
  });

  it.each(["desktop", "web", "mobile"])(
    "resolves a %s answer and records answeredVia app",
    async (surface) => {
      await withTestHarness(async (harness) => {
        const thread = seedFormThread(harness.deps, `accept-${surface}`);
        const { pending, interactionId } = requestForm(harness.deps, {
          threadId: thread.id,
          requireAppAnswer: true,
        });

        const response = await respond(harness, {
          threadId: thread.id,
          interactionId,
          surface,
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          status: "resolved",
          resolution: { kind: "plugin_submitted", answeredVia: "app" },
        });
        await expect(pending).resolves.toEqual({
          outcome: "submitted",
          value: FORM_ANSWER,
        });
      });
    },
  );

  it("answers an api caller with 403, not 409, while an app answer is mid-submit", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedFormThread(harness.deps, "mid-submit");
      let finishDescription!: () => void;
      let enteredDescription!: () => void;
      const gate = new Promise<void>((resolve) => {
        finishDescription = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        enteredDescription = resolve;
      });
      const { pending, interactionId } = requestForm(harness.deps, {
        threadId: thread.id,
        requireAppAnswer: true,
        describeSubmission: async () => {
          enteredDescription();
          await gate;
          return { title: "Plan approved" };
        },
      });
      const appAnswer = respond(harness, {
        threadId: thread.id,
        interactionId,
        surface: "desktop",
      });

      try {
        await entered;
        await expectRefused(
          await respond(harness, { threadId: thread.id, interactionId }),
        );
      } finally {
        finishDescription();
      }

      expect((await appAnswer).status).toBe(200);
      await expect(pending).resolves.toMatchObject({ outcome: "submitted" });
    });
  });

  it("logs a refused answer with the thread and interaction ids and no payload", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedFormThread(harness.deps, "warn");
      const warn = vi.spyOn(harness.deps.logger, "warn");
      const { interactionId } = requestForm(harness.deps, {
        threadId: thread.id,
        requireAppAnswer: true,
      });

      try {
        await respond(harness, { threadId: thread.id, interactionId });

        const call = warn.mock.calls.find((args) =>
          String(args[1]).includes("did not come from the bb app"),
        );
        expect(call?.[0]).toEqual({
          threadId: thread.id,
          interactionId,
        });
        expect(JSON.stringify(warn.mock.calls)).not.toContain("approved");
      } finally {
        await respond(harness, {
          threadId: thread.id,
          interactionId,
          surface: "desktop",
        });
        warn.mockRestore();
      }
    });
  });

  it("keeps an unflagged form answerable from the api and records answeredVia api", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedFormThread(harness.deps, "unflagged");
      const { pending, interactionId } = requestForm(harness.deps, {
        threadId: thread.id,
        requireAppAnswer: false,
      });

      const response = await respond(harness, {
        threadId: thread.id,
        interactionId,
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: "resolved",
        resolution: { kind: "plugin_submitted", answeredVia: "api" },
      });
      await expect(pending).resolves.toMatchObject({ outcome: "submitted" });
    });
  });

  it("returns answeredVia from the thread events list", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedFormThread(harness.deps, "events");
      const { interactionId } = requestForm(harness.deps, {
        threadId: thread.id,
        requireAppAnswer: true,
      });
      await respond(harness, {
        threadId: thread.id,
        interactionId,
        surface: "web",
      });

      const events = await harness.app.request(
        `/api/v1/threads/${thread.id}/events?type=${encodeURIComponent("system/interaction/lifecycle")}`,
      );
      expect(events.status).toBe(200);
      const rows = (await events.json()) as Array<{
        data: {
          interaction: { id: string; status: string; resolution: JsonValue };
        };
      }>;
      const resolved = rows.find(
        (row) =>
          row.data.interaction.id === interactionId &&
          row.data.interaction.status === "resolved",
      );
      expect(resolved?.data.interaction.resolution).toMatchObject({
        kind: "plugin_submitted",
        answeredVia: "app",
      });
    });
  });

  it("passes experimental_requireAppAnswer from bb.ui.requestInput to the waiter", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedFormThread(harness.deps, "wiring");
      const root = join(harness.config.dataDir, "app-answer-fixture");
      await mkdir(root, { recursive: true });
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({
          name: "bb-plugin-app-answer",
          version: "0.1.0",
          bb: {
            name: "App answer fixture",
            description: "Requests a form that needs an app answer.",
            branding: { icon: "Zap" },
            server: "./server.ts",
          },
        }),
      );
      await writeFile(
        join(root, "server.ts"),
        `
          export default function plugin(bb: any) {
            void bb.ui.requestInput(
              { threadId: ${JSON.stringify(thread.id)}, rendererId: "probe", title: "Probe", payload: {} },
              { experimental_requireAppAnswer: true },
            );
          }
        `,
      );
      await harness.pluginService.installPath(root);
      await expect
        .poll(() =>
          harness.deps.pendingInteractions.listPendingThreadInteractions(
            thread.id,
          ),
        )
        .toHaveLength(1);
      const [interaction] =
        harness.deps.pendingInteractions.listPendingThreadInteractions(
          thread.id,
        );

      await expectRefused(
        await respond(harness, {
          threadId: thread.id,
          interactionId: interaction!.id,
        }),
      );
      expect(storedStatus(harness.deps, interaction!.id)).toBe("pending");
      const accepted = await respond(harness, {
        threadId: thread.id,
        interactionId: interaction!.id,
        surface: "desktop",
      });
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toMatchObject({
        status: "resolved",
        resolution: { kind: "plugin_submitted", answeredVia: "app" },
      });
    });
  });
});
