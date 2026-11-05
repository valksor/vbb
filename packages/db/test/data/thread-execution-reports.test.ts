import { describe, expect, it } from "vitest";
import {
  getThreadExecutionReport,
  upsertThreadExecutionReport,
} from "../../src/data/thread-execution-reports.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import { createThread, deleteThread } from "../../src/data/threads.js";
import { noopNotifier } from "../../src/notifier.js";
import { createMigratedConnection } from "../../src/testing.js";

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const first = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "claude-code",
  });
  const second = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "claude-code",
  });
  return { db, first, second };
}

describe("thread execution reports", () => {
  it("returns null when absent, replaces complete reports, and keeps thread rows independent", () => {
    const { db, first, second } = setup();
    expect(getThreadExecutionReport(db, first.id)).toBeNull();

    upsertThreadExecutionReport(db, {
      threadId: first.id,
      execution: {
        model: "claude-opus-4-6",
        reasoningLevel: "high",
        permissionMode: "accept-edits",
        serviceTier: "fast",
      },
      reportedAt: 1,
    });
    upsertThreadExecutionReport(db, {
      threadId: second.id,
      execution: {
        model: "claude-sonnet-4-5",
        reasoningLevel: "medium",
        permissionMode: "auto",
        serviceTier: "default",
      },
      reportedAt: 2,
    });
    upsertThreadExecutionReport(db, {
      threadId: first.id,
      execution: {
        model: "claude-haiku-4-5",
        reasoningLevel: null,
        permissionMode: null,
        serviceTier: null,
      },
      reportedAt: 3,
    });

    expect(getThreadExecutionReport(db, first.id)).toEqual({
      model: "claude-haiku-4-5",
      reasoningLevel: null,
      permissionMode: null,
      serviceTier: null,
      reportedAt: 3,
    });
    expect(getThreadExecutionReport(db, second.id)).toEqual({
      model: "claude-sonnet-4-5",
      reasoningLevel: "medium",
      permissionMode: "auto",
      serviceTier: "default",
      reportedAt: 2,
    });
  });

  it("deletes a report when its thread is deleted", () => {
    const { db, first } = setup();
    upsertThreadExecutionReport(db, {
      threadId: first.id,
      execution: {
        model: "claude-opus-4-6",
        reasoningLevel: null,
        permissionMode: null,
        serviceTier: null,
      },
      reportedAt: 1,
    });

    expect(deleteThread(db, noopNotifier, first.id)).toBe(true);
    expect(getThreadExecutionReport(db, first.id)).toBeNull();
  });
});
