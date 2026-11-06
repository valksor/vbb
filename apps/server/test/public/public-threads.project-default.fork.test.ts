import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { resolveProjectDefaultThreadEnvironment } from "../../src/services/threads/thread-default-policy.js";
import { installFakePersonalWorkspaceProvider } from "../helpers/environment-provider.js";
import { seedHostSession, seedPrimaryHost } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("project-default thread environment", () => {
  it("resolves the personal project to the personal provider on the primary host", async () => {
    await withTestHarness(async (harness) => {
      installFakePersonalWorkspaceProvider();
      const { host } = seedHostSession(harness.deps, {
        id: "host-personal-default",
      });
      seedPrimaryHost(harness.deps, host.id);
      await expect(
        resolveProjectDefaultThreadEnvironment(harness.deps, {
          projectId: PERSONAL_PROJECT_ID,
        }),
      ).resolves.toEqual({
        type: "provider",
        environmentProviderId: "personal-workspace",
        machine: { type: "existing", hostId: host.id },
        inputs: null,
      });
    });
  });
});
