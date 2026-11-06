import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { noopNotifier } from "../../src/notifier.js";
import {
  bindEnvironmentPath,
  createEnvironment,
  reserveEnvironment,
} from "../../src/data/environments.js";
import { environments } from "../../src/schema.js";
import { createProject } from "../../src/data/projects.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createThread } from "../../src/data/threads.js";
import { createMigratedConnection } from "../../src/testing.js";

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  return { db, host, project };
}

describe("bindEnvironmentPath", () => {
  function adoptionFixture() {
    const { db, host, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const existing = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/adopted",
      status: "ready",
      providerOwnsPath: true,
      environmentProvider: {
        environmentProviderId: "project-checkout",
        pluginId: "environment-project-checkout",
        instanceKey: "existing-key",
        selection: {
          machine: { type: "existing", hostId: "retired-host" },
          inputs: { path: "/tmp/adopted" },
        },
      },
    });
    const reserved = reserveEnvironment(db, {
      projectId: project.id,
      hostId: host.id,
      ownerThreadId: thread.id,
      attempt: 1,
      status: "creating",
      providerOwnsPath: false,
      environmentProviderId: "project-checkout",
      environmentProviderPluginId: "environment-project-checkout",
      environmentProviderInstanceKey: `${thread.id}-1`,
      environmentProviderSelection: {
        machine: { type: "existing", hostId: host.id },
        inputs: {},
      },
    });
    return { db, host, project, thread, existing, reserved };
  }

  it("records the adopting reservation's selection and the adopted status", () => {
    const fixture = adoptionFixture();

    const adopted = bindEnvironmentPath(
      fixture.db,
      fixture.reserved,
      "/tmp/adopted",
    );

    expect(adopted.id).toBe(fixture.existing.id);
    expect(adopted.environmentProviderSelection).toEqual({
      machine: { type: "existing", hostId: fixture.host.id },
      inputs: {},
    });
    expect(adopted.environmentProviderInstanceKey).toBe("existing-key");
    expect(adopted.providerOwnsPath).toBe(true);
    expect(adopted.adoptedFromStatus).toBe("ready");
  });

  it("clears the adopted marker when a removed reservation is reused", () => {
    const fixture = adoptionFixture();
    bindEnvironmentPath(fixture.db, fixture.reserved, "/tmp/adopted");
    fixture.db
      .update(environments)
      .set({ teardownStatus: "removed" })
      .where(eq(environments.id, fixture.existing.id))
      .run();

    const reused = reserveEnvironment(fixture.db, {
      projectId: fixture.project.id,
      hostId: fixture.host.id,
      ownerThreadId: fixture.thread.id,
      attempt: 2,
      status: "creating",
      providerOwnsPath: false,
      environmentProviderId: "project-checkout",
      environmentProviderPluginId: "environment-project-checkout",
      environmentProviderInstanceKey: `${fixture.thread.id}-2`,
      environmentProviderSelection: {
        machine: { type: "existing", hostId: fixture.host.id },
        inputs: {},
      },
    });

    expect(reused.id).toBe(fixture.existing.id);
    expect(reused.adoptedFromStatus).toBeNull();
  });
});
