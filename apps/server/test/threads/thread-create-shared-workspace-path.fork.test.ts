import { getEnvironment } from "@bb/db";
import { describe, expect, it, vi } from "vitest";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { DEFAULT_ENVIRONMENT_PROVIDER_ID } from "../../src/services/environments/environment-provider-ids.js";
import {
  checkoutProviderInputsSchema,
  installFakeEnvironmentProvider,
} from "../helpers/environment-provider.js";
import { waitForQueuedCommand } from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("attaching to a path that already has an environment", () => {
  const CHECKOUT_PATH = "/tmp/adopted-checkout-repo";

  it("starts a thread that adopts a checkout recorded with another selection", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-adopt-checkout-selection",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Adopting Checkout Project",
        path: CHECKOUT_PATH,
      });
      const existing = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: CHECKOUT_PATH,
        environmentProviderId: DEFAULT_ENVIRONMENT_PROVIDER_ID.projectCheckout,
        environmentProviderPluginId: "environment-project-checkout",
        environmentProviderInstanceKey: "existing-checkout-instance",
        environmentProviderSelection: {
          machine: { type: "existing", hostId: host.id },
          inputs: { path: CHECKOUT_PATH },
        },
      });
      installFakeEnvironmentProvider({
        id: DEFAULT_ENVIRONMENT_PROVIDER_ID.projectCheckout,
        pluginId: "environment-project-checkout",
        displayName: "Checkout",
        requires: {
          projectCheckout: true,
          gitCheckout: false,
          gitRemote: false,
          projectless: false,
        },
        inputs: checkoutProviderInputsSchema,
        decide: () => ({
          action: "ready",
          environment: {
            type: "host",
            hostId: host.id,
            path: CHECKOUT_PATH,
            ownsPath: false,
          },
        }),
      });

      const thread = await createThreadFromRequest(harness.deps, {
        environment: {
          type: "provider",
          environmentProviderId:
            DEFAULT_ENVIRONMENT_PROVIDER_ID.projectCheckout,
          machine: { type: "existing", hostId: host.id },
          inputs: {},
        },
        input: textInput("Work in the adopted checkout"),
        origin: "app",
        projectId: project.id,
        providerId: "codex",
        startedOnBehalfOf: null,
      });

      await waitForQueuedCommand(
        harness,
        (queued) =>
          queued.command.type === "thread.start" &&
          queued.command.threadId === thread.id,
      );
      await vi.waitFor(() => {
        const adopted = getEnvironment(harness.deps.db, existing.id);
        expect(adopted).toMatchObject({
          status: "ready",
          path: CHECKOUT_PATH,
          environmentProviderInstanceKey: "existing-checkout-instance",
        });
        expect(adopted?.environmentProviderSelection).toEqual({
          machine: { type: "existing", hostId: host.id },
          inputs: {},
        });
      });
    });
  });
});
