import { describe, expect, it, vi } from "vitest";
import { noopNotifier } from "../../src/notifier.js";
import type { DbNotifier } from "../../src/notifier.js";
import { createThread, updateThread } from "../../src/data/threads.js";
import { createProject } from "../../src/data/projects.js";
import { upsertHost } from "../../src/data/hosts.js";
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

describe("threads", () => {
  it("notifies when worktree promotion is declined", () => {
    const { db, project } = setup();
    const spy: DbNotifier = {
      notifyThread: vi.fn(),
      notifyEnvironment: vi.fn(),
      notifyHost: vi.fn(),
      notifyProject: vi.fn(),
      notifySystem: vi.fn(),
    };
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      worktreePromotion: "armed",
    });

    updateThread(db, spy, thread.id, { worktreePromotion: "declined" });

    expect(spy.notifyThread).toHaveBeenCalledWith(
      thread.id,
      ["environment-changed"],
      { projectId: project.id },
    );
  });
});
