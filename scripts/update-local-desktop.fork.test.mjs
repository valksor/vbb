import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, test as nodeTest } from "node:test";
const localUpdateEnvironment = [
  "BB_LOCAL_UPSTREAM_SLUG",
  "BB_LOCAL_UPSTREAM_BRANCH",
  "BB_LOCAL_FORK_BRANCH",
].map((key) => [key, process.env[key]]);
for (const [key] of localUpdateEnvironment) delete process.env[key];
const {
  assertNotInsideBb,
  backupAppPath,
  beginCleanup,
  collectionEntryNames,
  collectionManifestUrl,
  collectionSourceKey,
  createMaintenanceClient,
  ensurePluginServerAvailable,
  externalPluginSyncAction,
  installedBbLocalCli,
  interruptCheckpoint,
  interruptRequested,
  pauseWork,
  readUpdateState,
  runInstallUpdate,
  localMainProcessPattern,
  recoverLeftoverLease,
  recoverLocalApp,
  recoveryInstructions,
  releaseLease,
  requestInterrupt,
  resetInterruption,
  readPluginsOnlyUpdateState,
  resolveDataDir,
  resolvePluginsOnlyCli,
  resolveExternalPlugins,
  run,
  runPausedUpdate,
  syncCollectionPlugin,
  syncPluginsOnly,
  throwIfInterrupted,
  unlistedCollectionPluginIds,
  updateOtherPlugins,
  updateStatePath,
  installAndActivateLocalApp,
  npmEnvironment,
  parseLocalUpdateArgs,
  pushArguments,
  readCollectionOutcomes,
  readPluginOutcomes,
  resolveBbCli,
  resolveForkRemote,
  remoteSlug,
  resolveRemoteNames,
  waitForLocalServerHealth,
  waitForProcessExit,
  writeUpdateState,
} = await import("./update-local-desktop.fork.mjs");
for (const [key, value] of localUpdateEnvironment) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

const fixtureTestNames = new Set([
  "plugins-only update state check reads valid, absent, and unreadable state files",
  "resolves the CLI from an installed desktop app when bb is not on PATH",
  "current checkout mode completes without fetch or rebase",
  "current checkout mode builds a dirty worktree and lists the changes",
  "current checkout mode keeps a Team ID signature instead of ad-hoc signing",
  "current checkout mode ad-hoc signs when codesign cannot display the signature",
  "current checkout mode ad-hoc signs when the app has no Team ID",
  "current checkout mode refuses to push a dirty worktree",
  "rebase mode refuses a dirty worktree before fetching",
  "rebase mode refuses to push a different branch before fetching",
  "current checkout mode refuses to push without a tracking head",
  "current checkout mode refuses to push a different branch",
  "current checkout mode refuses a fork remote that pushes upstream",
  "identifies remotes using the shipped default slug",
  "respects upstream and fork branch overrides",
  "strips undefined environment entries from spawned children",
  "a parent-only signal fails a child that exited cleanly, and cleanup is exempt",
  "recovers a leftover desktop update lease and clears its state",
  "refuses a lease it does not own and clears stale state when none is held",
  "seals with a state file naming the cohort, and aborts cleanly when sealing fails",
  "a real SIGTERM sent only to the updater process still releases the pause",
  "after the update is applied a signal says so and carries no recovery text",
  "resetting the interruption state restores the pause release notice",
  "gives up waiting for bb Local health after the deadline",
  "waits for the target process before accepting local health",
  "an interrupted seal still releases the lease with checks disabled and reports recovery when that fails",
  "an interrupted acquire releases a lease the server may already hold",
  "keeps recovery usable when the state file is unreadable or the lease is foreign",
  "install flow records the backup before swapping and resumes after plugins",
  "install flow restores the backup and force-aborts when the new app is unhealthy",
  "install flow does not restore when the install rolled itself back",
  "install flow keeps the lease and prints the backup when the restored app also fails",
  "install flow force-aborts after a plugin sync failure without touching the app",
]);

const test = (name, fn) =>
  nodeTest(`${fixtureTestNames.has(name) ? "fixture" : "pure"}: ${name}`, fn);
afterEach(() => resetInterruption());

test("installs the local app before stopping bb and starts the replacement", async () => {
  const events = [];
  await installAndActivateLocalApp({
    install: async () => events.push("install"),
    startLocal: async () => events.push("start-local"),
    stopOfficial: async () => events.push("stop-official"),
  });
  assert.deepEqual(events, ["install", "stop-official", "start-local"]);

  await assert.rejects(
    installAndActivateLocalApp({
      install: async () => {
        throw new Error("install failed");
      },
      startLocal: async () => events.push("unexpected-start"),
      stopOfficial: async () => events.push("unexpected-stop"),
    }),
    /install failed/u,
  );
  assert.deepEqual(events, ["install", "stop-official", "start-local"]);
});

test("starts the official app when plugin synchronization has no server", async () => {
  const events = [];
  let attempts = 0;
  await ensurePluginServerAvailable({
    readSource: () => {
      attempts += 1;
      events.push(`read-${attempts}`);
      if (attempts === 1) throw new Error("Cannot connect to BB server");
    },
    startOfficial: async () => events.push("start-official"),
  });
  assert.deepEqual(events, ["read-1", "start-official", "read-2"]);

  await assert.rejects(
    ensurePluginServerAvailable({
      readSource: () => {
        throw new Error("still unavailable");
      },
      startOfficial: async () => {},
    }),
    /cannot connect to the official BB server after starting it.*still unavailable/su,
  );
});

test("syncs plugins only against a reachable server", async () => {
  const plugins = [{ id: "alpha", plugin: "alpha", source: "git:x@master" }];
  const synced = [];
  await syncPluginsOnly({
    resolveCli: async () => "/fake/bb",
    readState: async () => null,
    readSource: (cli, id) => {
      assert.deepEqual([cli, id], ["/fake/bb", "shared-runtime"]);
      return null;
    },
    resolvePlugins: async () => plugins,
    sync: async (cli, resolved) => synced.push([cli, resolved]),
    updateOthers: async () => {},
  });
  assert.deepEqual(synced, [["/fake/bb", plugins]]);
});

test("plugins-only updates other plugins after the sync with the collection ids", async (t) => {
  t.mock.method(console, "log", () => {});
  const calls = [];
  await syncPluginsOnly({
    resolveCli: async () => "/fake/bb",
    readState: async () => null,
    readSource: () => null,
    resolvePlugins: async () => [
      { id: "alpha", plugin: "alpha", source: "git:x@master" },
      { id: "beta", plugin: "beta", source: "git:x@master" },
    ],
    sync: async () => calls.push("sync"),
    updateOthers: async (cli, skipIds) => calls.push(["others", cli, skipIds]),
  });
  assert.deepEqual(calls, ["sync", ["others", "/fake/bb", ["alpha", "beta"]]]);
});

test("plugins-only skips the other plugin pass when otherPlugins is false", async (t) => {
  t.mock.method(console, "log", () => {});
  const calls = [];
  await syncPluginsOnly({
    resolveCli: async () => "/fake/bb",
    readState: async () => null,
    readSource: () => null,
    resolvePlugins: async () => [],
    sync: async () => calls.push("sync"),
    otherPlugins: false,
    updateOthers: async () => calls.push("others"),
  });
  assert.deepEqual(calls, ["sync"]);
});

test("plugins-only skips the other plugin pass when the sync fails", async (t) => {
  t.mock.method(console, "log", () => {});
  const calls = [];
  await assert.rejects(
    syncPluginsOnly({
      resolveCli: async () => "/fake/bb",
      readState: async () => null,
      readSource: () => null,
      resolvePlugins: async () => [],
      sync: async () => {
        throw new Error("sync failed");
      },
      updateOthers: async () => calls.push("others"),
    }),
    /sync failed/u,
  );
  assert.deepEqual(calls, []);
});

function otherPluginHarness({
  outdated,
  failUpdate = [],
  onRead = () => {},
  onCommand = () => {},
} = {}) {
  const logs = [];
  const warnings = [];
  const commands = [];
  const reads = [];
  const queue = [...outdated];
  const dependencies = {
    readOutdated: async () => {
      reads.push("read");
      onRead();
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) throw next;
      return next;
    },
    command: (args) => {
      commands.push(args.join(" "));
      onCommand();
      if (failUpdate.includes(args.at(-1))) {
        throw new Error(`update ${args.at(-1)} failed`);
      }
      return { status: 0, stdout: "", stderr: "" };
    },
    isInterrupted: interruptRequested,
    checkpoint: interruptCheckpoint,
    log: (message) => logs.push(message),
    warn: (message) => warnings.push(message),
  };
  return { dependencies, logs, warnings, commands, reads };
}

const outdatedEntry = (id, outcome, candidate) => ({
  id,
  outcome,
  installed: { version: "1", display: `${id}@1` },
  ...(candidate === undefined ? {} : { candidate: { display: candidate } }),
});

test("other plugin updates apply only update-available non-skipped valid ids", async () => {
  const harness = otherPluginHarness({
    outdated: [
      [
        outdatedEntry("pets", "update-available", "pets@2"),
        outdatedEntry("collection-one", "update-available", "c@2"),
        outdatedEntry("pinned-one", "pinned"),
        outdatedEntry("current-one", "current"),
        outdatedEntry("old-one", "incompatible"),
        outdatedEntry("gone-one", "unavailable"),
        outdatedEntry("Bad_Id", "update-available", "x"),
      ],
      [outdatedEntry("pets", "current")],
    ],
  });
  const result = await updateOtherPlugins(
    ["collection-one"],
    harness.dependencies,
  );
  assert.deepEqual(harness.commands, ["plugin update --yes pets"]);
  assert.deepEqual(result, { attempted: ["pets"], failed: [] });
  assert.deepEqual(harness.warnings, [
    'Skipping other plugin update(s) with an unsupported id: "Bad_Id"',
  ]);
  assert.ok(
    harness.logs.some(
      (line) =>
        line.includes("old-one (incompatible)") &&
        line.includes("gone-one (unavailable)") &&
        !line.includes("collection-one"),
    ),
  );
  assert.ok(
    harness.logs.includes("Updating 1 other plugin(s): pets pets@1 → pets@2"),
  );
});

test("other plugin updates report when nothing is pending", async () => {
  const harness = otherPluginHarness({
    outdated: [[outdatedEntry("pets", "current")]],
  });
  const result = await updateOtherPlugins([], harness.dependencies);
  assert.deepEqual(result, { attempted: [], failed: [] });
  assert.deepEqual(harness.commands, []);
  assert.ok(harness.logs.includes("No other plugin updates."));
});

test("other plugin updates fall back to latest compatible without a candidate", async () => {
  const harness = otherPluginHarness({
    outdated: [
      [outdatedEntry("pets", "update-available")],
      [outdatedEntry("pets", "current")],
    ],
  });
  await updateOtherPlugins([], harness.dependencies);
  assert.ok(
    harness.logs.includes(
      "Updating 1 other plugin(s): pets pets@1 → latest compatible",
    ),
  );
});

test("one failing other plugin update does not stop the rest", async () => {
  const harness = otherPluginHarness({
    failUpdate: ["alpha"],
    outdated: [
      [
        outdatedEntry("alpha", "update-available", "a@2"),
        outdatedEntry("beta", "update-available", "b@2"),
      ],
      [
        outdatedEntry("alpha", "update-available", "a@2"),
        outdatedEntry("beta", "current"),
      ],
    ],
  });
  const result = await updateOtherPlugins([], harness.dependencies);
  assert.deepEqual(harness.commands, [
    "plugin update --yes alpha",
    "plugin update --yes beta",
  ]);
  assert.deepEqual(result, { attempted: ["alpha", "beta"], failed: ["alpha"] });
  assert.ok(
    harness.warnings.some((line) => line.includes("update alpha failed")),
  );
  assert.ok(
    harness.warnings.some((line) =>
      /incomplete: alpha; see the output above/u.test(line),
    ),
  );
});

test("other plugin updates warn instead of throwing when outdated is unusable", async () => {
  for (const outdated of [
    new Error("outdated exploded"),
    new SyntaxError("Unexpected token"),
    { not: "an array" },
  ]) {
    const harness = otherPluginHarness({ outdated: [outdated] });
    const result = await updateOtherPlugins([], harness.dependencies);
    assert.deepEqual(result, { attempted: [], failed: [] });
    assert.deepEqual(harness.commands, []);
    assert.equal(harness.warnings.length, 1);
    assert.match(harness.warnings[0], /^Skipping other plugin updates: /u);
  }
});

test("the default outdated read parses command output and survives bad output", async () => {
  const warnings = [];
  const commands = [];
  const result = await updateOtherPlugins([], {
    command: (args, options) => {
      commands.push([args.join(" "), options]);
      return { status: 0, stdout: "not json", stderr: "" };
    },
    readTimeoutMs: 5,
    log: () => {},
    warn: (message) => warnings.push(message),
  });
  assert.deepEqual(result, { attempted: [], failed: [] });
  assert.deepEqual(commands, [
    ["plugin outdated --json", { capture: true, timeoutMs: 5 }],
  ]);
  assert.equal(warnings.length, 1);
  const failing = [];
  await updateOtherPlugins([], {
    command: () => {
      throw new Error("bb plugin outdated --json exited 3");
    },
    log: () => {},
    warn: (message) => failing.push(message),
  });
  assert.match(failing[0], /exited 3/u);
});

test("other plugin updates report ids that still have an update available", async () => {
  const harness = otherPluginHarness({
    outdated: [
      [outdatedEntry("pets", "update-available", "p@2")],
      [outdatedEntry("pets", "update-available", "p@2")],
    ],
  });
  const result = await updateOtherPlugins([], harness.dependencies);
  assert.deepEqual(result, { attempted: ["pets"], failed: ["pets"] });
  assert.ok(
    harness.warnings.includes("Plugin pets still has an update available"),
  );
});

test("a failing re-check warns that the result could not be verified", async () => {
  const harness = otherPluginHarness({
    outdated: [
      [outdatedEntry("pets", "update-available", "p@2")],
      new Error("recheck failed"),
    ],
  });
  const result = await updateOtherPlugins([], harness.dependencies);
  assert.deepEqual(result, { attempted: ["pets"], failed: [] });
  assert.ok(
    harness.warnings.some((line) =>
      /^Could not verify other plugin updates: recheck failed/u.test(line),
    ),
  );
});

test("other plugin updates stop when an interrupt is already pending", async () => {
  resetInterruption();
  requestInterrupt("SIGINT");
  try {
    const harness = otherPluginHarness({
      outdated: [[outdatedEntry("alpha", "update-available", "a@2")]],
    });
    await assert.rejects(
      updateOtherPlugins([], harness.dependencies),
      /interrupted by SIGINT/u,
    );
    assert.deepEqual(harness.reads, []);
    assert.deepEqual(harness.commands, []);
  } finally {
    resetInterruption();
  }
});

test("other plugin updates stop the loop after an interrupt between updates", async () => {
  resetInterruption();
  try {
    const harness = otherPluginHarness({
      outdated: [
        [
          outdatedEntry("alpha", "update-available", "a@2"),
          outdatedEntry("beta", "update-available", "b@2"),
        ],
      ],
      onCommand: () => requestInterrupt("SIGINT"),
    });
    await assert.rejects(
      updateOtherPlugins([], harness.dependencies),
      /interrupted by SIGINT/u,
    );
    assert.deepEqual(harness.commands, ["plugin update --yes alpha"]);
  } finally {
    resetInterruption();
  }
});

test("an interrupt delivered after a failed outdated read is rethrown, not warned", async () => {
  resetInterruption();
  try {
    const harness = otherPluginHarness({
      outdated: [new Error("outdated killed")],
      onRead: () => setImmediate(() => requestInterrupt("SIGINT")),
    });
    await assert.rejects(
      updateOtherPlugins([], harness.dependencies),
      /interrupted by SIGINT/u,
    );
    assert.deepEqual(harness.warnings, []);
    assert.deepEqual(harness.commands, []);
  } finally {
    resetInterruption();
  }
});

test("an interrupt delivered after a failed update is rethrown, not warned", async () => {
  resetInterruption();
  try {
    const harness = otherPluginHarness({
      outdated: [[outdatedEntry("alpha", "update-available", "a@2")]],
      failUpdate: ["alpha"],
      onCommand: () => setImmediate(() => requestInterrupt("SIGINT")),
    });
    await assert.rejects(
      updateOtherPlugins([], harness.dependencies),
      /interrupted by SIGINT/u,
    );
    assert.deepEqual(harness.warnings, []);
  } finally {
    resetInterruption();
  }
});

test("the interruption checks still fire after cleanup began", async () => {
  resetInterruption();
  requestInterrupt("SIGTERM");
  beginCleanup();
  try {
    assert.doesNotThrow(() => throwIfInterrupted());
    const harness = otherPluginHarness({
      outdated: [[outdatedEntry("alpha", "update-available", "a@2")]],
    });
    await assert.rejects(
      updateOtherPlugins([], harness.dependencies),
      /interrupted by SIGTERM/u,
    );
    assert.deepEqual(harness.commands, []);
  } finally {
    resetInterruption();
  }
});

test("a timed out other plugin update warns that the server may still finish it", async () => {
  const harness = otherPluginHarness({
    outdated: [
      [outdatedEntry("alpha", "update-available", "a@2")],
      [outdatedEntry("alpha", "current")],
    ],
  });
  const received = [];
  harness.dependencies.command = (args, options) => {
    received.push(options?.timeoutMs);
    throw Object.assign(new Error("spawnSync bb ETIMEDOUT"), {
      code: "ETIMEDOUT",
    });
  };
  const result = await updateOtherPlugins([], {
    ...harness.dependencies,
    updateTimeoutMs: 7000,
  });
  assert.deepEqual(received, [7000]);
  assert.deepEqual(result.failed, ["alpha"]);
  assert.ok(
    harness.warnings.includes(
      "Plugin alpha update timed out after 7s; the server-side update may still finish",
    ),
  );
});

test("other plugin updates fail an attempted id missing from the re-check", async () => {
  const harness = otherPluginHarness({
    outdated: [
      [outdatedEntry("alpha", "update-available", "a@2")],
      [outdatedEntry("other", "current")],
    ],
  });
  const result = await updateOtherPlugins([], harness.dependencies);
  assert.deepEqual(result.failed, ["alpha"]);
  assert.ok(
    harness.warnings.includes(
      "Plugin alpha is no longer installed or was not reported after its update",
    ),
  );
});

test("other plugin updates neutralise control characters in plugin supplied values", async () => {
  const harness = otherPluginHarness({
    outdated: [
      [
        outdatedEntry("bad\u001b[2Jid", "update-available", "x"),
        outdatedEntry("alpha", "update-available", "a@2"),
        outdatedEntry("old\u001b[2Jone", "unavailable"),
      ],
      [outdatedEntry("alpha", "weird\u001b[2J")],
    ],
  });
  await updateOtherPlugins([], harness.dependencies);
  const text = [...harness.warnings, ...harness.logs].join("\n");
  assert.ok(!text.includes("\u001b"));
  assert.ok(text.includes(JSON.stringify("bad\u001b[2Jid")));
  assert.ok(text.includes(JSON.stringify("weird\u001b[2J")));
  assert.ok(text.includes(JSON.stringify("old\u001b[2Jone")));
});

test("other plugin updates use shared default timeouts", async () => {
  const seen = [];
  await updateOtherPlugins([], {
    command: (args, options) => {
      seen.push([args.join(" "), options.timeoutMs]);
      return {
        status: 0,
        stdout: JSON.stringify([outdatedEntry("alpha", "update-available")]),
        stderr: "",
      };
    },
    log: () => {},
    warn: () => {},
  });
  assert.deepEqual(seen, [
    ["plugin outdated --json", 120_000],
    ["plugin update --yes alpha", 600_000],
    ["plugin outdated --json", 120_000],
  ]);
});

test("other plugin updates warn about ids they cannot update", async () => {
  const harness = otherPluginHarness({
    outdated: [[outdatedEntry("Bad_Id", "update-available", "x")]],
  });
  const result = await updateOtherPlugins([], harness.dependencies);
  assert.deepEqual(result, { attempted: [], failed: [] });
  assert.deepEqual(harness.commands, []);
  assert.ok(
    harness.warnings.some((line) => /unsupported id: "Bad_Id"/u.test(line)),
  );
});

test("other plugin updates flag attempted ids that are not current afterwards", async () => {
  const harness = otherPluginHarness({
    outdated: [
      [
        outdatedEntry("alpha", "update-available", "a@2"),
        outdatedEntry("beta", "update-available", "b@2"),
        outdatedEntry("gamma", "update-available", "g@2"),
      ],
      [
        outdatedEntry("alpha", "update-available", "a@2"),
        outdatedEntry("beta", "incompatible"),
        outdatedEntry("gamma", "current"),
      ],
    ],
  });
  const result = await updateOtherPlugins([], harness.dependencies);
  assert.deepEqual(result.failed, ["alpha", "beta"]);
  assert.ok(
    harness.warnings.includes("Plugin alpha still has an update available"),
  );
  assert.ok(
    harness.warnings.includes('Plugin beta did not update ("incompatible")'),
  );
});

test("plugins-only refuses to sync when no server answers", async () => {
  const calls = [];
  await assert.rejects(
    syncPluginsOnly({
      resolveCli: async () => "/fake/bb",
      readState: async () => null,
      readSource: () => {
        throw new Error("Cannot connect to BB server");
      },
      resolvePlugins: async () => calls.push("resolve"),
      sync: async () => calls.push("sync"),
    }),
    (error) => {
      assert.match(
        error.message,
        /cannot reach a BB server through \/fake\/bb; start bb Local \(or bb\), or set BB_CLI to the running bb's CLI\nCannot connect to BB server/u,
      );
      assert.equal(error.cause.message, "Cannot connect to BB server");
      return true;
    },
  );
  assert.deepEqual(calls, []);
});

test("plugins-only checks state, resolves the CLI, probes, resolves the manifest, then syncs", async (t) => {
  t.mock.method(console, "log", () => {});
  const calls = [];
  await syncPluginsOnly({
    resolveCli: async () => {
      calls.push("resolveCli");
      return "/fake/bb";
    },
    readSource: () => calls.push("probe"),
    readState: async () => {
      calls.push("readState");
      return null;
    },
    resolvePlugins: async () => {
      calls.push("resolve");
      return [];
    },
    sync: async () => calls.push("sync"),
    updateOthers: async () => calls.push("others"),
  });
  assert.deepEqual(calls, [
    "readState",
    "resolveCli",
    "probe",
    "resolve",
    "sync",
    "others",
  ]);
});

test("plugins-only refuses during or after a desktop update before touching the CLI", async (t) => {
  t.mock.method(console, "log", () => {});
  const calls = [];
  await assert.rejects(
    syncPluginsOnly({
      resolveCli: async () => calls.push("resolveCli"),
      readSource: () => calls.push("probe"),
      readState: async () => ({ operationId: "op-7" }),
      resolvePlugins: async () => calls.push("resolve"),
      sync: async () => calls.push("sync"),
    }),
    /a desktop update \(operation op-7\) is in progress or was interrupted and may have left bb Local paused; if no update is running, run pnpm desktop:local:update -- --recover first/u,
  );
  assert.deepEqual(calls, []);
});

test("plugins-only update state check reads valid, absent, and unreadable state files", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "bb-plugins-only-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  assert.equal(await readPluginsOnlyUpdateState(dataDir), null);
  await writeUpdateState(dataDir, {
    operationId: "op-9",
    hostIds: [],
    backupApp: null,
  });
  assert.equal((await readPluginsOnlyUpdateState(dataDir)).operationId, "op-9");
  await writeFile(updateStatePath(dataDir), "{not json");
  assert.deepEqual(await readPluginsOnlyUpdateState(dataDir), {
    operationId: "unknown (unreadable state file)",
  });
});

test("plugins-only picks BB_CLI, then bb Local's CLI, then the fallback", async () => {
  const resolved = [];
  const resolve = async (environment) => {
    resolved.push(environment.BB_CLI ?? null);
    return "/fallback/bb";
  };
  const executable = async () => "/real/bb-local";
  const missing = async () => null;
  assert.equal(
    await resolvePluginsOnlyCli(
      { BB_CLI: "/custom/bb" },
      { bbLocalCli: "/bb-local", resolve, isExecutable: executable },
    ),
    "/fallback/bb",
  );
  assert.deepEqual(resolved, ["/custom/bb"]);
  assert.equal(
    await resolvePluginsOnlyCli(
      {},
      { bbLocalCli: "/bb-local", resolve, isExecutable: executable },
    ),
    "/bb-local",
  );
  assert.equal(
    await resolvePluginsOnlyCli(
      { BB_CLI: "  " },
      { bbLocalCli: "/bb-local", resolve, isExecutable: executable },
    ),
    "/bb-local",
  );
  assert.deepEqual(resolved, ["/custom/bb"]);
  assert.equal(
    await resolvePluginsOnlyCli(
      {},
      { bbLocalCli: "/bb-local", resolve, isExecutable: missing },
    ),
    "/fallback/bb",
  );
  assert.deepEqual(resolved, ["/custom/bb", null]);
});

test("plugins-only does not sync when the manifest cannot be resolved", async () => {
  const calls = [];
  await assert.rejects(
    syncPluginsOnly({
      resolveCli: async () => "/fake/bb",
      readState: async () => null,
      readSource: () => null,
      resolvePlugins: async () => {
        throw new Error("cannot fetch collection manifest");
      },
      sync: async () => calls.push("sync"),
    }),
    /cannot fetch collection manifest/u,
  );
  assert.deepEqual(calls, []);
});

test("resolves the CLI from an installed desktop app when bb is not on PATH", async () => {
  const applicationsRoot = await mkdtemp(
    path.join(os.tmpdir(), "bb-local-updater-applications-"),
  );
  const cli = path.join(
    applicationsRoot,
    "bb.app",
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "node_modules",
    "bb-app",
    "host-daemon",
    "dist",
    "bb",
  );
  try {
    await mkdir(path.dirname(cli), { recursive: true });
    await writeFile(cli, "#!/bin/sh\n", { mode: 0o755 });

    assert.equal(
      await resolveBbCli({ PATH: "" }, { applicationsRoot }),
      await realpath(cli),
    );
  } finally {
    await rm(applicationsRoot, { recursive: true, force: true });
  }
});

test("parses updater modes", () => {
  assert.deepEqual(parseLocalUpdateArgs([]), {
    check: false,
    current: false,
    install: true,
    otherPlugins: true,
    plugins: true,
    pluginsOnly: false,
    push: true,
    recover: false,
  });
  assert.deepEqual(parseLocalUpdateArgs(["--plugins-only"]), {
    check: false,
    current: false,
    install: true,
    otherPlugins: true,
    plugins: true,
    pluginsOnly: true,
    push: true,
    recover: false,
  });
  assert.deepEqual(
    parseLocalUpdateArgs(["--plugins-only", "--skip-other-plugins"]),
    {
      check: false,
      current: false,
      install: true,
      otherPlugins: false,
      plugins: true,
      pluginsOnly: true,
      push: true,
      recover: false,
    },
  );
  assert.equal(
    parseLocalUpdateArgs(["--skip-other-plugins", "--skip-plugins"])
      .otherPlugins,
    false,
  );
  assert.throws(
    () => parseLocalUpdateArgs(["--plugins-only", "--skip-push"]),
    /--plugins-only cannot be combined with `--skip-push`/u,
  );
  assert.throws(
    () => parseLocalUpdateArgs(["--check", "--plugins-only"]),
    /--plugins-only cannot be combined with `--check`/u,
  );
  assert.deepEqual(
    parseLocalUpdateArgs([
      "--",
      "--check",
      "--current",
      "--skip-install",
      "--skip-plugins",
      "--skip-push",
      "--recover",
    ]),
    {
      check: true,
      current: true,
      install: false,
      otherPlugins: true,
      plugins: false,
      pluginsOnly: false,
      push: false,
      recover: true,
    },
  );
  assert.throws(
    () => parseLocalUpdateArgs(["--wat"]),
    /unknown argument: --wat; valid flags: --check, --current, --recover, --skip-install, --skip-plugins, --skip-other-plugins, --skip-push/u,
  );
});

async function createCurrentUpdaterFixture({
  branch = "main",
  forkHead = "fork123",
  pushUrl = "https://github.com/valksor/vbb.git",
  remoteUrl = "https://github.com/valksor/vbb.git",
  includeFork = true,
  slug,
} = {}) {
  const binDirectory = await mkdtemp(
    path.join(os.tmpdir(), "bb-local-updater-current-bin-"),
  );
  const commandLog = path.join(binDirectory, "commands.log");
  const fakeGit = path.join(binDirectory, "git");
  await writeFile(commandLog, "");
  await writeFile(
    fakeGit,
    `#!/bin/sh
printf 'git %s\n' "$*" >> "$BB_TEST_COMMAND_LOG"
case "$*" in
  "rev-parse --show-toplevel") /bin/pwd ;;
  "branch --show-current") printf '%s\n' "$BB_TEST_BRANCH" ;;
  "status --porcelain=v1 --untracked-files=all") printf '%s' "$BB_TEST_STATUS" ;;
  "rev-parse --short HEAD") printf '%s\n' abc1234 ;;
  "remote -v")
    printf '%s\n' "_get-bb https://github.com/get-bb/bb.git (fetch)"
    if [ "$BB_TEST_INCLUDE_FORK" = "1" ]; then
      printf '%s\n' "origin $BB_TEST_FORK_URL (fetch)"
    fi
    ;;
  "remote get-url --push --all _get-bb") printf '%s\n' "https://github.com/get-bb/bb.git" ;;
  "remote get-url --push --all origin") printf '%s\n' "$BB_TEST_PUSH_URL" ;;
  "rev-parse --verify refs/remotes/origin/"*)
    if [ -n "$BB_TEST_FORK_HEAD" ]; then printf '%s\n' "$BB_TEST_FORK_HEAD"; else exit 1; fi
    ;;
  "fetch _get-bb "*) ;;
  "fetch origin "*) ;;
  "merge-base --is-ancestor "*) ;;
  "rebase "*) ;;
  "rev-list --count "*) printf '%s\n' 0 ;;
  "push --force-with-lease=refs/heads/"*" origin HEAD:"*) ;;
  *) printf '%s\n' "unexpected git command: $*" >&2; exit 97 ;;
esac
`,
    { mode: 0o755 },
  );
  const fakeTool = `#!/bin/sh
tool=\${0##*/}
printf '%s %s\n' "$tool" "$*" >> "$BB_TEST_COMMAND_LOG"
`;
  const fakeCodesign = `${fakeTool}if [ "$1" = "-dv" ]; then
  if [ -n "$BB_TEST_CODESIGN_DV_STDERR" ]; then
    printf '%s\\n' "$BB_TEST_CODESIGN_DV_STDERR" >&2
  fi
  exit "\${BB_TEST_CODESIGN_DV_EXIT:-0}"
fi
`;
  await Promise.all([
    ...["node", "pnpm", "npm"].map((tool) =>
      writeFile(path.join(binDirectory, tool), fakeTool, { mode: 0o755 }),
    ),
    writeFile(path.join(binDirectory, "codesign"), fakeCodesign, {
      mode: 0o755,
    }),
  ]);
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith("BB_LOCAL_")) delete environment[key];
  }
  delete environment.BB_THREAD_ID;
  delete environment.BB_TERMINAL_SESSION_ID;
  if (slug) environment.BB_LOCAL_UPSTREAM_SLUG = slug;
  return {
    binDirectory,
    commandLog,
    env: {
      ...environment,
      BB_TEST_BRANCH: branch,
      BB_TEST_COMMAND_LOG: commandLog,
      BB_TEST_FORK_HEAD: forkHead,
      BB_TEST_FORK_URL: remoteUrl,
      BB_TEST_INCLUDE_FORK: includeFork ? "1" : "0",
      BB_TEST_PUSH_URL: pushUrl,
      BB_TEST_STATUS: "",
      PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  };
}

function runCurrentUpdater(fixture, ...args) {
  return spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), "scripts", "update-local-desktop.mjs"),
      "--current",
      "--skip-install",
      "--skip-plugins",
      ...args,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: fixture.env,
    },
  );
}

test("current checkout mode completes without fetch or rebase", async () => {
  const fixture = await createCurrentUpdaterFixture();
  try {
    const result = runCurrentUpdater(fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /current checkout abc1234/u);
    assert.match(result.stdout, /updated from current checkout abc1234/u);
    const commands = await readFile(fixture.commandLog, "utf8");
    assert.doesNotMatch(commands, /^git (?:fetch|rebase)\b/mu);
    assert.match(
      commands,
      /^node --test --test-concurrency=1 scripts\/update-local-desktop\.fork\.test\.mjs$/mu,
    );
    assert.match(commands, /^pnpm desktop:local:package$/mu);
    assert.match(
      commands,
      /^git push --force-with-lease=refs\/heads\/main:fork123 origin HEAD:main$/mu,
    );
  } finally {
    await rm(fixture.binDirectory, { recursive: true, force: true });
  }
});

test("current checkout mode builds a dirty worktree and lists the changes", async () => {
  const fixture = await createCurrentUpdaterFixture();
  fixture.env.BB_TEST_STATUS = " M scripts/a.mjs\n?? notes.txt";
  try {
    const result = runCurrentUpdater(fixture, "--skip-push");
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /Uncommitted changes:\n M scripts\/a\.mjs\n\?\? notes\.txt/u,
    );
    assert.match(result.stdout, /updated from current checkout abc1234-dirty/u);
    const commands = await readFile(fixture.commandLog, "utf8");
    assert.doesNotMatch(commands, /^git (?:fetch|rebase|push)\b/mu);
    assert.match(commands, /^pnpm desktop:local:package$/mu);
    assert.match(commands, /^codesign --force --deep --sign - /mu);
    assert.match(commands, /^codesign --verify --deep --strict /mu);
  } finally {
    await rm(fixture.binDirectory, { recursive: true, force: true });
  }
});

test("current checkout mode keeps a Team ID signature instead of ad-hoc signing", async () => {
  const fixture = await createCurrentUpdaterFixture();
  fixture.env.BB_TEST_CODESIGN_DV_STDERR = [
    "Executable=/tmp/BB Local.app/Contents/MacOS/BB Local",
    "Identifier=dev.bb.desktop.local",
    "Format=app bundle with Mach-O thin (arm64)",
    "CodeDirectory v=20500 size=1234 flags=0x10000(runtime) hashes=30+7 location=embedded",
    "Signature size=4797",
    "TeamIdentifier=ABCDE12345",
    "Sealed Resources version=2 rules=13 files=11500",
    "Internal requirements count=1 size=204",
  ].join("\n");
  try {
    const result = runCurrentUpdater(fixture, "--skip-push");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Keeping Team ID signature \(ABCDE12345\)/u);
    const commands = await readFile(fixture.commandLog, "utf8");
    assert.match(commands, /^codesign -dv /mu);
    assert.doesNotMatch(commands, /^codesign --force\b/mu);
    assert.match(commands, /^codesign --verify --deep --strict /mu);
  } finally {
    await rm(fixture.binDirectory, { recursive: true, force: true });
  }
});

test("current checkout mode ad-hoc signs when codesign cannot display the signature", async () => {
  const fixture = await createCurrentUpdaterFixture();
  fixture.env.BB_TEST_CODESIGN_DV_STDERR = "TeamIdentifier=ABCDE12345";
  fixture.env.BB_TEST_CODESIGN_DV_EXIT = "1";
  try {
    const result = runCurrentUpdater(fixture, "--skip-push");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No Team ID signature; ad-hoc signing/u);
    const commands = await readFile(fixture.commandLog, "utf8");
    assert.match(commands, /^codesign --force --deep --sign - /mu);
    assert.match(commands, /^codesign --verify --deep --strict /mu);
  } finally {
    await rm(fixture.binDirectory, { recursive: true, force: true });
  }
});

test("current checkout mode ad-hoc signs when the app has no Team ID", async () => {
  const fixture = await createCurrentUpdaterFixture();
  fixture.env.BB_TEST_CODESIGN_DV_STDERR = "TeamIdentifier=not set";
  try {
    const result = runCurrentUpdater(fixture, "--skip-push");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No Team ID signature; ad-hoc signing/u);
    const commands = await readFile(fixture.commandLog, "utf8");
    assert.match(commands, /^codesign --force --deep --sign - /mu);
    assert.match(commands, /^codesign --verify --deep --strict /mu);
  } finally {
    await rm(fixture.binDirectory, { recursive: true, force: true });
  }
});

test("current checkout mode refuses to push a dirty worktree", async () => {
  const fixture = await createCurrentUpdaterFixture();
  fixture.env.BB_TEST_STATUS = " M scripts/a.mjs";
  try {
    const result = runCurrentUpdater(fixture);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /commit them or use --skip-push/u);
    const commands = await readFile(fixture.commandLog, "utf8");
    assert.doesNotMatch(commands, /^(?:pnpm|npm|codesign)\b/mu);
    assert.doesNotMatch(commands, /^git push\b/mu);
  } finally {
    await rm(fixture.binDirectory, { recursive: true, force: true });
  }
});

test("rebase mode refuses a dirty worktree before fetching", async () => {
  const fixture = await createCurrentUpdaterFixture();
  fixture.env.BB_TEST_STATUS = " M scripts/a.mjs";
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), "scripts", "update-local-desktop.mjs"),
        "--skip-install",
        "--skip-plugins",
        "--skip-push",
      ],
      { cwd: process.cwd(), encoding: "utf8", env: fixture.env },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not clean\n M scripts\/a\.mjs/u);
    const commands = await readFile(fixture.commandLog, "utf8");
    assert.doesNotMatch(commands, /^git (?:fetch|rebase)\b/mu);
  } finally {
    await rm(fixture.binDirectory, { recursive: true, force: true });
  }
});

test("rebase mode refuses to push a different branch before fetching", async () => {
  const defaultMismatch = await createCurrentUpdaterFixture({
    branch: "feature/current",
  });
  const overriddenMismatch = await createCurrentUpdaterFixture();
  overriddenMismatch.env.BB_LOCAL_FORK_BRANCH = "feature/current";
  for (const fixture of [defaultMismatch, overriddenMismatch]) {
    try {
      const result = spawnSync(
        process.execPath,
        [
          path.join(process.cwd(), "scripts", "update-local-desktop.mjs"),
          "--skip-install",
          "--skip-plugins",
        ],
        { cwd: process.cwd(), encoding: "utf8", env: fixture.env },
      );
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /does not match push target.*--skip-push/su,
      );
      const commands = await readFile(fixture.commandLog, "utf8");
      assert.doesNotMatch(commands, /^git fetch\b/mu);
      assert.doesNotMatch(commands, /^(?:pnpm|npm|codesign)\b/mu);
      assert.doesNotMatch(commands, /^git push\b/mu);
    } finally {
      await rm(fixture.binDirectory, { recursive: true, force: true });
    }
  }

  const matching = await createCurrentUpdaterFixture();
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), "scripts", "update-local-desktop.mjs"),
        "--skip-install",
        "--skip-plugins",
      ],
      { cwd: process.cwd(), encoding: "utf8", env: matching.env },
    );
    assert.equal(result.status, 0, result.stderr);
    const commands = await readFile(matching.commandLog, "utf8");
    assert.match(commands, /^git fetch _get-bb main$/mu);
    assert.match(commands, /^git fetch origin main$/mu);
    assert.match(commands, /^git push\b/mu);
  } finally {
    await rm(matching.binDirectory, { recursive: true, force: true });
  }

  const skipPush = await createCurrentUpdaterFixture({
    branch: "feature/current",
  });
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), "scripts", "update-local-desktop.mjs"),
        "--skip-install",
        "--skip-plugins",
        "--skip-push",
      ],
      { cwd: process.cwd(), encoding: "utf8", env: skipPush.env },
    );
    assert.equal(result.status, 0, result.stderr);
    const commands = await readFile(skipPush.commandLog, "utf8");
    assert.match(commands, /^git fetch _get-bb main$/mu);
    assert.match(commands, /^git fetch origin main$/mu);
    assert.doesNotMatch(commands, /^git push\b/mu);
  } finally {
    await rm(skipPush.binDirectory, { recursive: true, force: true });
  }
});

test("current checkout mode refuses to push without a tracking head", async () => {
  const fixture = await createCurrentUpdaterFixture({ forkHead: "" });
  try {
    const result = runCurrentUpdater(fixture);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /cannot safely push.*fetch the fork first or use --skip-push/su,
    );
    const commands = await readFile(fixture.commandLog, "utf8");
    assert.doesNotMatch(commands, /^(?:pnpm|npm|codesign)\b/mu);
    assert.doesNotMatch(commands, /^git push\b/mu);
  } finally {
    await rm(fixture.binDirectory, { recursive: true, force: true });
  }
});

test("current checkout mode refuses to push a different branch", async () => {
  const fixture = await createCurrentUpdaterFixture({
    branch: "feature/current",
  });
  try {
    const result = runCurrentUpdater(fixture);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /branch feature\/current does not match push target main.*--skip-push/su,
    );
    const commands = await readFile(fixture.commandLog, "utf8");
    assert.doesNotMatch(commands, /^git remote -v$/mu);
    assert.doesNotMatch(commands, /^(?:pnpm|npm|codesign)\b/mu);
  } finally {
    await rm(fixture.binDirectory, { recursive: true, force: true });
  }

  const overriddenFixture = await createCurrentUpdaterFixture();
  overriddenFixture.env.BB_LOCAL_FORK_BRANCH = "feature/current";
  try {
    const result = runCurrentUpdater(overriddenFixture);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /branch main does not match push target feature\/current.*--skip-push/su,
    );
    const commands = await readFile(overriddenFixture.commandLog, "utf8");
    assert.doesNotMatch(commands, /^git remote -v$/mu);
    assert.doesNotMatch(commands, /^(?:pnpm|npm|codesign)\b/mu);
  } finally {
    await rm(overriddenFixture.binDirectory, { recursive: true, force: true });
  }
});

test("current checkout mode refuses a fork remote that pushes upstream", async () => {
  const fixture = await createCurrentUpdaterFixture({
    pushUrl: "https://github.com/get-bb/bb.git",
  });
  try {
    const result = runCurrentUpdater(fixture);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /refusing to force-push to upstream/u);
    const commands = await readFile(fixture.commandLog, "utf8");
    assert.doesNotMatch(commands, /^git push\b/mu);
    assert.doesNotMatch(commands, /^(?:node|pnpm|npm|codesign)\b/mu);
  } finally {
    await rm(fixture.binDirectory, { recursive: true, force: true });
  }
});

test("identifies remotes using the shipped default slug", async () => {
  const fixture = await createCurrentUpdaterFixture({
    includeFork: false,
  });
  try {
    const result = runCurrentUpdater(fixture);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no fork remote found/u);
    const commands = await readFile(fixture.commandLog, "utf8");
    assert.match(commands, /^git remote -v$/mu);
  } finally {
    await rm(fixture.binDirectory, { recursive: true, force: true });
  }
});

test("respects upstream and fork branch overrides", async () => {
  const fixture = await createCurrentUpdaterFixture({
    branch: "feature/current",
  });
  fixture.env.BB_LOCAL_UPSTREAM_BRANCH = "release";
  fixture.env.BB_LOCAL_FORK_BRANCH = "feature/current";
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), "scripts", "update-local-desktop.mjs"),
        "--skip-install",
        "--skip-plugins",
      ],
      { cwd: process.cwd(), encoding: "utf8", env: fixture.env },
    );
    assert.equal(result.status, 0, result.stderr);
    const commands = await readFile(fixture.commandLog, "utf8");
    assert.match(commands, /^git fetch _get-bb release$/mu);
    assert.match(commands, /^git fetch origin feature\/current$/mu);
    assert.match(
      commands,
      /^git rev-parse --verify refs\/remotes\/origin\/feature\/current$/mu,
    );
    assert.match(
      commands,
      /^git push --force-with-lease=refs\/heads\/feature\/current:fork123 origin HEAD:feature\/current$/mu,
    );
  } finally {
    await rm(fixture.binDirectory, { recursive: true, force: true });
  }
});

test("installs, updates, or reinstalls an external plugin by current source", () => {
  assert.equal(externalPluginSyncAction(null), "install");
  assert.equal(
    externalPluginSyncAction(
      "git:https://github.com/lettland/bb-plugins.git@main",
    ),
    "update",
  );
  assert.equal(externalPluginSyncAction("builtin:auto-review"), "reinstall");
  assert.equal(externalPluginSyncAction("path:/some/dir"), "reinstall");
});

test("reinstalls a git plugin whose collection repository moved", () => {
  assert.equal(
    externalPluginSyncAction(
      "git:https://github.com/k0d3r1s/bb-plugins.git@master",
      "git:https://github.com/lettland/bb-plugins.git@master",
    ),
    "reinstall",
  );
  assert.equal(
    externalPluginSyncAction(
      "git:https://github.com/lettland/bb-plugins.git@master",
      "git:https://github.com/lettland/bb-plugins.git@master",
    ),
    "update",
  );
  assert.equal(
    externalPluginSyncAction(
      "git:https://github.com/lettland/bb-plugins.git@30f91fd977ba1ce60532af27a68534464fb62516",
      "git:https://github.com/lettland/bb-plugins.git@master",
    ),
    "update",
  );
  assert.equal(
    externalPluginSyncAction(
      "git:https://git.example.com/lettland/bb-plugins.git@master",
      "git:https://github.com/lettland/bb-plugins.git@master",
    ),
    "update",
  );
});

test("collection outcome read surfaces an interruption without warning", async () => {
  const warnings = [];
  await assert.rejects(
    readCollectionOutcomes(
      () => {
        throw new Error("outdated exited 130");
      },
      {
        turn: async () => {
          throw new Error("interrupted by SIGINT");
        },
        warn: (line) => warnings.push(line),
      },
    ),
    /interrupted by SIGINT/u,
  );
  assert.deepEqual(warnings, []);
});

test("collection outcome read warns once and falls back when not interrupted", async () => {
  const warnings = [];
  const outcomes = await readCollectionOutcomes(
    () => {
      throw new Error("outdated exited 1");
    },
    { turn: async () => {}, warn: (line) => warnings.push(line) },
  );
  assert.equal(outcomes.size, 0);
  assert.deepEqual(warnings, [
    "Updating every collection plugin: outdated exited 1",
  ]);
});

const collectionTestPlugin = {
  id: "aislop",
  plugin: "aislop",
  source: "git:https://github.com/lettland/bb-plugins.git@master",
};

function collectionSyncHarness(installedSource) {
  const commands = [];
  const logs = [];
  return {
    commands,
    logs,
    options: (outcome) => ({
      command: (args) => commands.push(args.join(" ")),
      readSource: () => installedSource,
      outcome,
      log: (line) => logs.push(line),
    }),
  };
}

test("skips plugin update for a collection plugin that is already current", () => {
  const harness = collectionSyncHarness(collectionTestPlugin.source);
  syncCollectionPlugin(
    collectionTestPlugin,
    collectionTestPlugin.source,
    harness.options("current"),
  );
  assert.deepEqual(harness.commands, []);
  assert.deepEqual(harness.logs, ["Plugin aislop is up to date."]);
});

test("still updates a collection plugin unless its outcome is current", () => {
  for (const outcome of ["update-available", "pinned", "unavailable", null]) {
    const harness = collectionSyncHarness(collectionTestPlugin.source);
    syncCollectionPlugin(
      collectionTestPlugin,
      collectionTestPlugin.source,
      harness.options(outcome),
    );
    assert.deepEqual(harness.commands, ["plugin update --yes aislop"]);
    assert.deepEqual(harness.logs, []);
  }
});

test("installs and reinstalls a collection plugin regardless of its outcome", () => {
  const install = collectionSyncHarness(collectionTestPlugin.source);
  syncCollectionPlugin(collectionTestPlugin, null, install.options("current"));
  assert.deepEqual(install.commands, [
    `plugin install --yes --plugin aislop ${collectionTestPlugin.source}`,
  ]);
  const reinstall = collectionSyncHarness(collectionTestPlugin.source);
  syncCollectionPlugin(
    collectionTestPlugin,
    "builtin:aislop",
    reinstall.options("current"),
  );
  assert.deepEqual(reinstall.commands, [
    "plugin remove aislop",
    `plugin install --yes --plugin aislop ${collectionTestPlugin.source}`,
  ]);
});

test("reads plugin outcomes by id and ignores malformed entries", () => {
  const timeouts = [];
  const outcomes = readPluginOutcomes((args, options) => {
    assert.deepEqual(args, ["plugin", "outdated", "--json"]);
    timeouts.push(options.timeoutMs);
    return {
      stdout: JSON.stringify([
        { id: "aislop", outcome: "current" },
        { id: "pets", outcome: "update-available" },
        { id: "broken" },
        null,
      ]),
    };
  });
  assert.deepEqual(
    [...outcomes],
    [
      ["aislop", "current"],
      ["pets", "update-available"],
    ],
  );
  assert.deepEqual(timeouts, [120_000]);
});

test("warns once and returns no outcomes when plugin outdated fails", () => {
  const warnings = [];
  const throwing = readPluginOutcomes(
    () => {
      throw new Error("outdated exited 1");
    },
    { warn: (line) => warnings.push(line) },
  );
  const malformed = readPluginOutcomes(() => ({ stdout: "{}" }), {
    warn: (line) => warnings.push(line),
  });
  assert.equal(throwing.size, 0);
  assert.equal(malformed.size, 0);
  assert.deepEqual(warnings, [
    "Updating every collection plugin: outdated exited 1",
    "Updating every collection plugin: plugin outdated did not return a list",
  ]);
});

test("derives the raw collection manifest URL from a git source", () => {
  assert.equal(
    collectionManifestUrl(
      "git:https://github.com/lettland/bb-plugins.git@master",
    ),
    "https://raw.githubusercontent.com/lettland/bb-plugins/master/.bb/plugins.json",
  );
  assert.equal(
    collectionManifestUrl("git:https://github.com/lettland/bb-plugins@main"),
    "https://raw.githubusercontent.com/lettland/bb-plugins/main/.bb/plugins.json",
  );
  assert.equal(
    collectionManifestUrl(
      "git:https://github.com/lettland/bb-plugins.git@release/1.2",
    ),
    "https://raw.githubusercontent.com/lettland/bb-plugins/release/1.2/.bb/plugins.json",
  );
  assert.throws(
    () => collectionManifestUrl("npm:@lettland/bb-plugin-k0d3"),
    /collection manifest URL/u,
  );
});

test("reads plugin names from a collection manifest", () => {
  assert.deepEqual(
    collectionEntryNames({
      schemaVersion: 1,
      name: "lettland-plugins",
      plugins: [
        { name: "auto-review", source: "./plugins/auto-review" },
        { name: "k0d3", source: "./plugins/k0d3" },
      ],
    }),
    ["auto-review", "k0d3"],
  );
  assert.throws(
    () => collectionEntryNames({ schemaVersion: 2, plugins: [] }),
    /not a valid/u,
  );
  assert.throws(
    () =>
      collectionEntryNames({
        schemaVersion: 1,
        plugins: [{ source: "./plugins/x" }],
      }),
    /entry 0 has an invalid plugin name/u,
  );
  assert.throws(
    () =>
      collectionEntryNames({
        schemaVersion: 1,
        plugins: [{ name: "Bad Name", source: "./plugins/x" }],
      }),
    /invalid plugin name/u,
  );
  assert.throws(
    () =>
      collectionEntryNames({
        schemaVersion: 1,
        plugins: [
          { name: "dup", source: "./plugins/dup" },
          { name: "dup", source: "./plugins/dup2" },
        ],
      }),
    /more than once/u,
  );
});

test("expands a collection into one install spec per plugin", async () => {
  const requested = [];
  const plugins = await resolveExternalPlugins(
    [{ source: "git:https://github.com/lettland/bb-plugins.git@master" }],
    async (url) => {
      requested.push(url);
      return {
        ok: true,
        json: async () => ({
          schemaVersion: 1,
          name: "lettland-plugins",
          plugins: [
            { name: "auto-review", source: "./plugins/auto-review" },
            { name: "k0d3", source: "./plugins/k0d3" },
          ],
        }),
      };
    },
  );
  assert.deepEqual(requested, [
    "https://raw.githubusercontent.com/lettland/bb-plugins/master/.bb/plugins.json",
  ]);
  assert.deepEqual(plugins, [
    {
      id: "auto-review",
      plugin: "auto-review",
      source: "git:https://github.com/lettland/bb-plugins.git@master",
    },
    {
      id: "k0d3",
      plugin: "k0d3",
      source: "git:https://github.com/lettland/bb-plugins.git@master",
    },
  ]);
});

test("fails loudly when a collection manifest is unreachable", async () => {
  await assert.rejects(
    resolveExternalPlugins(
      [{ source: "git:https://github.com/lettland/bb-plugins.git@master" }],
      async () => ({ ok: false, status: 404, json: async () => ({}) }),
    ),
    /HTTP 404/u,
  );
});

test("labels a network failure with the manifest URL", async () => {
  await assert.rejects(
    resolveExternalPlugins(
      [{ source: "git:https://github.com/lettland/bb-plugins.git@master" }],
      async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      },
    ),
    /cannot fetch collection manifest at https:\/\/raw\.githubusercontent\.com\/.*getaddrinfo ENOTFOUND/u,
  );
});

test("labels a non-JSON manifest body with the manifest URL", async () => {
  await assert.rejects(
    resolveExternalPlugins(
      [{ source: "git:https://github.com/lettland/bb-plugins.git@master" }],
      async () => ({
        ok: true,
        json: async () => {
          throw new Error("Unexpected token <");
        },
      }),
    ),
    /is not valid JSON/u,
  );
});

test("keys a collection source by owner, repo, and ref, ignoring .git", () => {
  assert.equal(
    collectionSourceKey(
      "git:https://github.com/lettland/bb-plugins.git@master",
    ),
    "lettland/bb-plugins@master",
  );
  assert.equal(
    collectionSourceKey("git:https://github.com/lettland/bb-plugins@master"),
    "lettland/bb-plugins@master",
  );
  assert.equal(collectionSourceKey("builtin:auto-review"), null);
});

test("flags installed collection plugins that left the manifest", () => {
  const collections = [
    { source: "git:https://github.com/lettland/bb-plugins.git@master" },
  ];
  const desired = [
    {
      id: "k0d3",
      plugin: "k0d3",
      source: "git:https://github.com/lettland/bb-plugins.git@master",
    },
  ];
  const installed = [
    {
      id: "auto-review",
      source: "git:https://github.com/lettland/bb-plugins.git@master",
    },
    {
      id: "k0d3",
      source: "git:https://github.com/lettland/bb-plugins.git@master",
    },
    { id: "advisor", source: "git:https://github.com/salemsayed/x.git@main" },
    { id: "connect", source: "builtin:connect" },
  ];
  assert.deepEqual(
    unlistedCollectionPluginIds(installed, collections, desired),
    ["auto-review"],
  );
});

test("never removes plugins from another repo or a different ref", () => {
  const collections = [
    { source: "git:https://github.com/lettland/bb-plugins.git@master" },
  ];
  const installed = [
    {
      id: "same-repo-other-ref",
      source: "git:https://github.com/lettland/bb-plugins.git@next",
    },
    {
      id: "other-repo",
      source: "git:https://github.com/someone/else.git@main",
    },
  ];
  assert.deepEqual(unlistedCollectionPluginIds(installed, collections, []), []);
});

test("flags every collection plugin when the desired set is empty", () => {
  const collections = [
    { source: "git:https://github.com/lettland/bb-plugins.git@master" },
  ];
  const installed = [
    {
      id: "auto-review",
      source: "git:https://github.com/lettland/bb-plugins.git@master",
    },
    { id: "connect", source: "builtin:connect" },
  ];
  assert.deepEqual(unlistedCollectionPluginIds(installed, collections, []), [
    "auto-review",
  ]);
});

test("scopes desired ids per collection source, not as a flat union", () => {
  const collections = [
    { source: "git:https://github.com/lettland/bb-plugins.git@master" },
    { source: "git:https://github.com/lettland/other-plugins.git@master" },
  ];
  const desired = [
    {
      id: "shared",
      plugin: "shared",
      source: "git:https://github.com/lettland/bb-plugins.git@master",
    },
  ];
  const installed = [
    {
      id: "shared",
      source: "git:https://github.com/lettland/other-plugins.git@master",
    },
  ];
  assert.deepEqual(
    unlistedCollectionPluginIds(installed, collections, desired),
    ["shared"],
  );
});

test("throws instead of mass-removing when desired and collections are swapped", () => {
  const collections = [
    { source: "git:https://github.com/lettland/bb-plugins.git@master" },
  ];
  const desired = [
    {
      id: "k0d3",
      plugin: "k0d3",
      source: "git:https://github.com/lettland/bb-plugins.git@master",
    },
  ];
  const installed = [
    {
      id: "k0d3",
      source: "git:https://github.com/lettland/bb-plugins.git@master",
    },
  ];
  assert.deepEqual(
    unlistedCollectionPluginIds(installed, collections, desired),
    [],
  );
  assert.throws(
    () => unlistedCollectionPluginIds(installed, desired, collections),
    /missing a string id/u,
  );
});

test("pins a rewritten fork push to the fetched remote head", () => {
  assert.deepEqual(pushArguments("abc123", "fork"), [
    "push",
    "--force-with-lease=refs/heads/main:abc123",
    "fork",
    "HEAD:main",
  ]);
  assert.deepEqual(pushArguments(null, "fork"), ["push", "fork", "HEAD:main"]);
  assert.deepEqual(pushArguments(null, "origin"), [
    "push",
    "origin",
    "HEAD:main",
  ]);
});

test("reads the repository slug from either remote URL form", () => {
  assert.equal(remoteSlug("https://github.com/get-bb/bb.git"), "get-bb/bb");
  assert.equal(remoteSlug("git@github.com:lettland/bb.git"), "lettland/bb");
  assert.equal(remoteSlug("https://token@github.com/GET-BB/BB"), "get-bb/bb");
});

test("classifies remotes by URL rather than by name", async () => {
  assert.deepEqual(
    resolveRemoteNames([
      { name: "origin", url: "https://github.com/get-bb/bb.git" },
      { name: "fork", url: "https://github.com/lettland/bb.git" },
    ]),
    { fork: "fork", upstream: "origin" },
  );
  assert.deepEqual(
    resolveRemoteNames([
      { name: "_get-bb", url: "https://github.com/get-bb/bb.git" },
      { name: "origin", url: "https://github.com/lettland/bb.git" },
    ]),
    { fork: "origin", upstream: "_get-bb" },
  );

  const defaultEnvironment = new Map(
    [
      "BB_LOCAL_UPSTREAM_SLUG",
      "BB_LOCAL_UPSTREAM_BRANCH",
      "BB_LOCAL_FORK_BRANCH",
    ].map((key) => [key, process.env[key]]),
  );
  try {
    for (const key of defaultEnvironment.keys()) delete process.env[key];
    const defaultModule = await import(
      "./update-local-desktop.fork.mjs?public-defaults",
    );
    assert.deepEqual(
      defaultModule.resolveRemoteNames([
        { name: "_get-bb", url: "https://github.com/get-bb/bb.git" },
        { name: "origin", url: "https://github.com/valksor/vbb.git" },
      ]),
      { fork: "origin", upstream: "_get-bb" },
    );
    assert.deepEqual(
      defaultModule.resolveRemoteNames([
        { name: "origin", url: "https://github.com/get-bb/bb.git" },
        { name: "fork", url: "https://github.com/valksor/vbb.git" },
      ]),
      { fork: "fork", upstream: "origin" },
    );
    assert.deepEqual(defaultModule.pushArguments("abc123", "origin"), [
      "push",
      "--force-with-lease=refs/heads/main:abc123",
      "origin",
      "HEAD:main",
    ]);
    assert.deepEqual(defaultModule.pushArguments(null, "origin"), [
      "push",
      "origin",
      "HEAD:main",
    ]);
    assert.throws(
      () =>
        defaultModule.resolveRemoteNames([
          { name: "_get-bb", url: "https://github.com/get-bb/bb.git" },
          {
            name: "origin",
            url: "https://github.com/valksor/vbb.git",
            pushUrls: ["https://github.com/get-bb/bb.git"],
          },
        ]),
      /refusing to force-push to upstream/u,
    );
    assert.throws(
      () =>
        defaultModule.resolveForkRemote([
          {
            name: "origin",
            url: "https://github.com/valksor/vbb.git",
            pushUrls: ["https://github.com/get-bb/bb.git"],
          },
        ]),
      /refusing to force-push to upstream/u,
    );

    process.env.BB_LOCAL_UPSTREAM_SLUG = "valksor/vbb";
    const slugModule = await import(
      "./update-local-desktop.fork.mjs?upstream-slug-override",
    );
    assert.deepEqual(
      slugModule.resolveRemoteNames([
        { name: "origin", url: "https://github.com/valksor/vbb.git" },
        { name: "fork", url: "https://github.com/get-bb/bb.git" },
      ]),
      { fork: "fork", upstream: "origin" },
    );

    delete process.env.BB_LOCAL_UPSTREAM_SLUG;
    process.env.BB_LOCAL_FORK_BRANCH = "feature/current";
    const forkBranchModule = await import(
      "./update-local-desktop.fork.mjs?fork-branch-override",
    );
    assert.deepEqual(forkBranchModule.pushArguments("abc123", "origin"), [
      "push",
      "--force-with-lease=refs/heads/feature/current:abc123",
      "origin",
      "HEAD:feature/current",
    ]);
  } finally {
    for (const [key, value] of defaultEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("resolves a fork without requiring an upstream remote", () => {
  assert.equal(
    resolveForkRemote([
      { name: "origin", url: "https://github.com/lettland/bb.git" },
    ]),
    "origin",
  );
  assert.throws(
    () =>
      resolveForkRemote([
        { name: "origin", url: "https://github.com/get-bb/bb.git" },
      ]),
    /no fork remote found/u,
  );
  assert.throws(
    () =>
      resolveForkRemote([
        {
          name: "origin",
          pushUrls: ["https://github.com/get-bb/bb.git"],
          url: "https://github.com/lettland/bb.git",
        },
      ]),
    /refusing to force-push to upstream/u,
  );
});

test("lets the environment override remote discovery", () => {
  assert.deepEqual(
    resolveRemoteNames(
      [
        { name: "_get-bb", url: "https://github.com/get-bb/bb.git" },
        { name: "origin", url: "https://github.com/lettland/bb.git" },
        { name: "mirror", url: "https://github.com/lettland/bb-mirror.git" },
      ],
      { fork: "mirror", upstream: "_get-bb" },
    ),
    { fork: "mirror", upstream: "_get-bb" },
  );
  assert.throws(
    () =>
      resolveRemoteNames(
        [
          { name: "_get-bb", url: "https://github.com/get-bb/bb.git" },
          {
            name: "origin",
            url: "https://github.com/valksor/vbb.git",
            pushUrls: ["https://github.com/get-bb/bb.git"],
          },
        ],
        { fork: "origin", upstream: "_get-bb" },
      ),
    /refusing to force-push to upstream/u,
  );
});

test("refuses to guess a fork remote when only upstream is configured", () => {
  assert.throws(
    () =>
      resolveRemoteNames([
        { name: "origin", url: "https://github.com/get-bb/bb.git" },
      ]),
    /no fork remote found/u,
  );
});

test("refuses to guess upstream when no remote matches the slug", () => {
  assert.throws(
    () =>
      resolveRemoteNames([
        { name: "origin", url: "https://github.com/lettland/bb.git" },
        { name: "_get-bb", url: "https://ghe.example.com/mirror/bb.git" },
      ]),
    /no remote matches get-bb\/bb/u,
  );
  assert.deepEqual(
    resolveRemoteNames(
      [
        { name: "origin", url: "https://github.com/lettland/bb.git" },
        { name: "_get-bb", url: "https://ghe.example.com/mirror/bb.git" },
      ],
      { upstream: "_get-bb" },
    ),
    { fork: "origin", upstream: "_get-bb" },
  );
});

test("refuses overrides that collapse fork and upstream onto one remote", () => {
  assert.throws(
    () =>
      resolveRemoteNames(
        [
          { name: "_get-bb", url: "https://github.com/get-bb/bb.git" },
          { name: "mirror", url: "https://github.com/lettland/bb-mirror.git" },
        ],
        { fork: "mirror", upstream: "mirror" },
      ),
    /both resolve to mirror/u,
  );
});

test("refuses a fork override that points at upstream", () => {
  assert.throws(
    () =>
      resolveRemoteNames(
        [
          { name: "_get-bb", url: "https://github.com/get-bb/bb.git" },
          { name: "origin", url: "https://github.com/lettland/bb.git" },
        ],
        { fork: "_get-bb" },
      ),
    /refusing to force-push to upstream/u,
  );
});

test("places unique app backups in Trash", () => {
  assert.equal(
    backupAppPath(new Date("2026-09-08T12:34:56.789Z")),
    path.join(
      os.homedir(),
      ".Trash",
      "bb-local-backup-2026-09-08T12-34-56-789Z.app",
    ),
  );
});

test("removes inherited npm script policy from nested npm commands", () => {
  assert.deepEqual(
    npmEnvironment({
      PATH: "/bin",
      npm_config_allow_scripts: "better-sqlite3",
      NPM_CONFIG_IGNORE_SCRIPTS: "true",
      npm_config_foreground_scripts: "true",
    }),
    { PATH: "/bin" },
  );
});

const lease = (phase, operationId = "desktop-update-x") => ({
  operationId,
  phase,
  reason: "desktop local update",
});

function fakeClient({
  phase = "sealed",
  operationId = "desktop-update-x",
  connected = [["local", "ncdata"]],
  releaseFailures = 0,
  releaseError = "BB maintenance request failed with HTTP 503: did not release work admission",
  current = lease(phase, operationId),
} = {}) {
  const calls = [];
  let identityCalls = 0;
  let failures = releaseFailures;
  return {
    calls,
    status: async () => ({ lease: current }),
    identity: async () => {
      const hostIds = connected[Math.min(identityCalls, connected.length - 1)];
      identityCalls += 1;
      return { connectedHostIds: hostIds };
    },
    transition: async (id, expected, next) => {
      calls.push(`transition ${expected}->${next}`);
    },
    release: async (id, resolution) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error(releaseError);
      }
      calls.push(`release ${resolution}`);
    },
  };
}

const fastTiming = { timeoutMs: 300, intervalMs: 5 };
const cohort = {
  operationId: "desktop-update-x",
  hostIds: ["local", "ncdata"],
};

test("refuses to run from inside bb", () => {
  assert.throws(
    () => assertNotInsideBb({ BB_THREAD_ID: "thr_1" }),
    /not from inside bb Local/u,
  );
  assert.throws(
    () => assertNotInsideBb({ BB_TERMINAL_SESSION_ID: "term_1" }),
    /not from inside bb Local/u,
  );
  assert.doesNotThrow(() => assertNotInsideBb({}));
});

test("resolves the data directory like the bb CLI", () => {
  assert.equal(resolveDataDir({}, "/home/u"), "/home/u/.bb");
  assert.equal(
    resolveDataDir({ BB_DATA_DIR: "/data/bb" }, "/home/u"),
    "/data/bb",
  );
  assert.equal(resolveDataDir({ BB_DATA_DIR: "~/x" }, "/home/u"), "/home/u/x");
  assert.throws(
    () => resolveDataDir({ BB_DATA_DIR: "rel" }, "/home/u"),
    /not an absolute path/u,
  );
});

test("targets the installed bb Local CLI with an explicit data dir and no inherited secret", () => {
  assert.equal(
    installedBbLocalCli,
    "/Applications/bb Local.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb",
  );
  const invocations = [];
  const client = createMaintenanceClient(
    installedBbLocalCli,
    "/data/bb",
    (command, args, options) => {
      invocations.push({ command, args, options });
      return { stdout: JSON.stringify({ lease: null }) };
    },
  );
  assert.deepEqual(client.status(), { lease: null });
  client.seal("desktop-update-x", { candidate: "c1", previous: "p1" });
  client.acquire("desktop-update-x");
  assert.equal(invocations[0].command, installedBbLocalCli);
  assert.deepEqual(invocations[0].args.slice(0, 4), [
    "maintenance",
    "--data-dir",
    "/data/bb",
    "--json",
  ]);
  assert.ok("BB_MAINTENANCE_OWNER_SECRET" in invocations[0].options.env);
  assert.equal(
    invocations[0].options.env.BB_MAINTENANCE_OWNER_SECRET,
    undefined,
  );
  assert.deepEqual(invocations[1].args.slice(4), [
    "seal",
    "desktop-update-x",
    "--candidate",
    "c1",
    "--previous",
    "p1",
    "--allow-active-work",
  ]);
  assert.deepEqual(invocations[2].args.slice(4), [
    "acquire",
    "--reason",
    "desktop local update",
    "--operation-id",
    "desktop-update-x",
  ]);
});

test("strips undefined environment entries from spawned children", () => {
  process.env.BB_MAINTENANCE_OWNER_SECRET = "from-parent";
  try {
    const result = run("/usr/bin/env", [], {
      capture: true,
      env: { BB_MAINTENANCE_OWNER_SECRET: undefined },
    });
    assert.doesNotMatch(result.stdout, /BB_MAINTENANCE_OWNER_SECRET/u);
  } finally {
    delete process.env.BB_MAINTENANCE_OWNER_SECRET;
  }
});

test("a parent-only signal fails a child that exited cleanly, and cleanup is exempt", async () => {
  try {
    requestInterrupt("SIGTERM");
    assert.throws(() => run("/usr/bin/true", []), /interrupted by SIGTERM/u);
    await assert.rejects(
      waitForProcessExit("^bb-updater-test-no-such-process$", 1_000),
      /interrupted by SIGTERM/u,
    );
    await assert.rejects(
      waitForLocalServerHealth(
        "bb Local app",
        "^bb-updater-test-no-such-process$",
      ),
      /interrupted by SIGTERM/u,
    );
    beginCleanup();
    assert.equal(run("/usr/bin/true", []).status, 0);
    assert.doesNotThrow(throwIfInterrupted);
  } finally {
    resetInterruption();
  }
});

function pausedSteps(events, overrides = {}) {
  const step =
    (name, result) =>
    async (...args) => {
      events.push(args.length > 0 ? `${name}:${args.join(",")}` : name);
      return result;
    };
  return {
    pause: step("pause", { operationId: "desktop-update-x" }),
    quit: step("quit"),
    build: step("build"),
    swap: step("swap"),
    syncPlugins: step("plugins"),
    recoverLocal: step("recover-local"),
    release: step("release"),
    recoveryText: () => "RECOVERY desktop-update-x",
    throwIfInterrupted: () => {},
    beginCleanup: () => events.push("cleanup"),
    ...overrides,
  };
}

test("pauses, quits, builds, installs, syncs plugins, then resumes in order", async () => {
  const events = [];
  await runPausedUpdate(pausedSteps(events));
  assert.deepEqual(events, [
    "pause",
    "quit",
    "build",
    "swap",
    "plugins",
    "cleanup",
    "release:completed",
  ]);
});

test("force-aborts the pause when any step fails and keeps the original error", async () => {
  for (const failing of ["quit", "build", "swap", "syncPlugins"]) {
    const events = [];
    await assert.rejects(
      runPausedUpdate(
        pausedSteps(events, {
          [failing]: async () => {
            throw new Error(`${failing} failed`);
          },
        }),
      ),
      (error) => error.message === `${failing} failed`,
    );
    assert.deepEqual(events.slice(-3), [
      "cleanup",
      "recover-local",
      "release:force-aborted",
    ]);
    assert.ok(!events.includes("release:completed"));
  }
});

test("force-aborts when a signal arrives while a step exits cleanly", async () => {
  const events = [];
  try {
    await assert.rejects(
      runPausedUpdate(
        pausedSteps(events, {
          build: async () => {
            events.push("build");
            requestInterrupt("SIGHUP");
          },
          throwIfInterrupted,
          beginCleanup,
        }),
      ),
      /interrupted by SIGHUP/u,
    );
    assert.deepEqual(events, [
      "pause",
      "quit",
      "build",
      "recover-local",
      "release:force-aborted",
    ]);
  } finally {
    resetInterruption();
  }
});

test("reports recovery steps and skips release when the restored app also fails", async () => {
  const events = [];
  await assert.rejects(
    runPausedUpdate(
      pausedSteps(events, {
        swap: async () => {
          throw new Error("new app unhealthy");
        },
        recoverLocal: async () => {
          throw new Error("restored app unhealthy");
        },
      }),
    ),
    /new app unhealthy[\s\S]*Also: restored app unhealthy[\s\S]*RECOVERY desktop-update-x/u,
  );
  assert.ok(!events.some((event) => event.startsWith("release")));
});

test("reports recovery steps when the final release fails and never force-aborts a finished update", async () => {
  const events = [];
  await assert.rejects(
    runPausedUpdate(
      pausedSteps(events, {
        release: async (resolution) => {
          events.push(`release:${resolution}`);
          throw new Error("ncdata offline");
        },
      }),
    ),
    /ncdata offline[\s\S]*RECOVERY desktop-update-x/u,
  );
  assert.deepEqual(
    events.filter((event) => event.startsWith("release")),
    ["release:completed"],
  );
});

test("a first install without bb Local skips quit, recovery and release", async () => {
  const events = [];
  await runPausedUpdate(pausedSteps(events, { pause: async () => null }));
  assert.deepEqual(events, ["build", "swap", "plugins", "cleanup"]);
  const failed = [];
  await assert.rejects(
    runPausedUpdate(
      pausedSteps(failed, {
        pause: async () => null,
        build: async () => {
          throw new Error("build failed");
        },
      }),
    ),
    (error) => error.message === "build failed",
  );
  assert.deepEqual(failed, ["cleanup"]);
});

test("restores the previous app only when the new one was swapped in but never became healthy", async () => {
  const run = async (state) => {
    const events = [];
    await recoverLocalApp({
      ...state,
      backupApp: "/Trash/backup.app",
      stopLocal: async () => events.push("stop"),
      restoreBackup: async (backup) => events.push(`restore:${backup}`),
      startLocal: async () => events.push("start"),
    });
    return events;
  };
  assert.deepEqual(await run({ swapped: true, activated: true }), []);
  assert.deepEqual(await run({ swapped: false, activated: false }), ["start"]);
  assert.deepEqual(await run({ swapped: true, activated: false }), [
    "stop",
    "restore:/Trash/backup.app",
    "start",
  ]);
  await assert.rejects(
    recoverLocalApp({
      swapped: true,
      activated: false,
      backupApp: "/Trash/backup.app",
      stopLocal: async () => {},
      restoreBackup: async () => {},
      startLocal: async () => {
        throw new Error("restored app exited before becoming healthy");
      },
    }),
    /restored app exited/u,
  );
});

test("releases each lease phase the way the server requires", async () => {
  const cases = [
    [
      "sealed",
      "completed",
      ["transition sealed->releasing", "release completed"],
    ],
    [
      "sealed",
      "force-aborted",
      ["transition sealed->releasing", "release force-aborted"],
    ],
    ["releasing", "completed", ["release completed"]],
    ["draining", "completed", ["release force-aborted"]],
    ["sealing", "completed", ["release force-aborted"]],
  ];
  for (const [phase, resolution, expected] of cases) {
    const client = fakeClient({ phase });
    assert.equal(
      await releaseLease(client, { ...cohort, resolution }, fastTiming),
      phase,
    );
    assert.deepEqual(client.calls, expected, `${phase}/${resolution}`);
  }
});

test("aborts on a phase the updater does not own or a lease it does not hold", async () => {
  for (const phase of [
    "activating",
    "verifying",
    "rolling-back",
    "rollback-failed",
  ]) {
    const client = fakeClient({ phase });
    await assert.rejects(
      releaseLease(client, { ...cohort, resolution: "completed" }, fastTiming),
      new RegExp(`desktop-update-x is in phase ${phase}`, "u"),
    );
    assert.deepEqual(client.calls, []);
  }
  const foreign = fakeClient({ operationId: "someone-else" });
  await assert.rejects(
    releaseLease(foreign, { ...cohort, resolution: "completed" }, fastTiming),
    /someone-else, not desktop-update-x/u,
  );
  assert.deepEqual(foreign.calls, []);
  const none = fakeClient({ current: null });
  assert.equal(
    await releaseLease(
      none,
      { ...cohort, resolution: "completed" },
      fastTiming,
    ),
    "none",
  );
});

test("waits for every cohort host and gives recovery guidance when one stays offline", async () => {
  const late = fakeClient({
    connected: [["local"], ["local"], ["local", "ncdata"]],
  });
  await releaseLease(late, { ...cohort, resolution: "completed" }, fastTiming);
  assert.deepEqual(late.calls, [
    "transition sealed->releasing",
    "release completed",
  ]);

  const offline = fakeClient({ connected: [["local"]] });
  await assert.rejects(
    releaseLease(offline, { ...cohort, resolution: "completed" }, fastTiming),
    /ncdata did not reconnect[\s\S]*503[\s\S]*restart its daemon[\s\S]*--recover/u,
  );
  assert.deepEqual(offline.calls, []);
});

test("retries a barrier failure for a bounded time", async () => {
  const flaky = fakeClient({ releaseFailures: 2 });
  await releaseLease(flaky, { ...cohort, resolution: "completed" }, fastTiming);
  assert.deepEqual(flaky.calls, [
    "transition sealed->releasing",
    "release completed",
  ]);

  const stuck = fakeClient({
    releaseFailures: 1_000,
    connected: [["local", "ncdata"]],
  });
  await assert.rejects(
    releaseLease(stuck, { ...cohort, resolution: "completed" }, fastTiming),
    /HTTP 503[\s\S]*--recover/u,
  );

  const other = fakeClient({
    releaseFailures: 1,
    releaseError: "invalid_phase",
  });
  await assert.rejects(
    releaseLease(other, { ...cohort, resolution: "completed" }, fastTiming),
    /invalid_phase/u,
  );
});

async function withDataDir(callback) {
  const dataDir = await mkdtemp(
    path.join(os.tmpdir(), "bb-local-updater-data-"),
  );
  try {
    await callback(dataDir);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

async function writeOwnerFile(dataDir, operationId) {
  await mkdir(path.join(dataDir, "admin", "operations"), { recursive: true });
  await writeFile(
    path.join(dataDir, "admin", "operations", `${operationId}.json`),
    "{}",
  );
}

test("recovers a leftover desktop update lease and clears its state", async () => {
  await withDataDir(async (dataDir) => {
    await writeUpdateState(dataDir, {
      operationId: "desktop-update-x",
      hostIds: ["local", "ncdata"],
      backupApp: null,
    });
    assert.equal((await stat(updateStatePath(dataDir))).mode & 0o777, 0o600);
    await writeOwnerFile(dataDir, "desktop-update-x");
    const client = fakeClient({ phase: "sealed" });
    const logs = [];
    assert.equal(
      await recoverLeftoverLease(
        client,
        {
          dataDir,
          hasOwnerFile: async () => true,
          log: (line) => logs.push(line),
        },
        fastTiming,
      ),
      true,
    );
    assert.deepEqual(client.calls, [
      "transition sealed->releasing",
      "release force-aborted",
    ]);
    assert.match(logs[0], /leftover desktop update pause desktop-update-x/u);
    assert.equal(await readUpdateState(dataDir), null);
  });
});

test("refuses a lease it does not own and clears stale state when none is held", async () => {
  await withDataDir(async (dataDir) => {
    const options = { dataDir, hasOwnerFile: async () => true };
    await assert.rejects(
      recoverLeftoverLease(
        fakeClient({ operationId: "vps-update-1" }),
        options,
        fastTiming,
      ),
      /operation vps-update-1, phase sealed/u,
    );
    await assert.rejects(
      recoverLeftoverLease(
        fakeClient({ phase: "sealed" }),
        options,
        fastTiming,
      ),
      /operation desktop-update-x/u,
    );
    await writeUpdateState(dataDir, {
      operationId: "desktop-update-x",
      hostIds: [],
      backupApp: null,
    });
    await assert.rejects(
      recoverLeftoverLease(
        fakeClient({ phase: "sealed" }),
        { dataDir, hasOwnerFile: async () => false },
        fastTiming,
      ),
      /operation desktop-update-x/u,
    );
    assert.equal(
      await recoverLeftoverLease(
        fakeClient({ current: null }),
        options,
        fastTiming,
      ),
      false,
    );
    assert.equal(await readUpdateState(dataDir), null);
  });
});

test("seals with a state file naming the cohort, and aborts cleanly when sealing fails", async () => {
  await withDataDir(async (dataDir) => {
    const barrier = (...ids) => ids.map((hostId) => ({ hostId }));
    const sealingClient = {
      acquire: async () => ({ barrier: barrier("local") }),
      seal: async () => ({
        barrier: barrier("local", "ncdata"),
        activity: { activeByKind: { "turn.submit": 2, "terminal.open": 1 } },
      }),
    };
    const paused = await pauseWork(sealingClient, {
      dataDir,
      previous: "p1",
      candidate: "c1",
      now: new Date("2026-10-06T12:00:00.000Z"),
    });
    assert.deepEqual(paused, {
      operationId: "desktop-update-2026-10-06T12-00-00-000Z",
      hostIds: ["local", "ncdata"],
    });
    assert.deepEqual(await readUpdateState(dataDir), {
      operationId: paused.operationId,
      hostIds: ["local", "ncdata"],
      backupApp: null,
    });

    const failing = fakeClient({
      phase: "draining",
      operationId: "desktop-update-2026-10-06T12-00-00-000Z",
    });
    failing.acquire = async () => ({ barrier: barrier("local") });
    failing.seal = async () => {
      throw new Error("seal refused");
    };
    await assert.rejects(
      pauseWork(
        failing,
        {
          dataDir,
          previous: "p1",
          candidate: "c1",
          now: new Date("2026-10-06T12:00:00.000Z"),
        },
        fastTiming,
      ),
      (error) => error.message === "seal refused",
    );
    assert.deepEqual(failing.calls, ["release force-aborted"]);
    assert.equal(await readUpdateState(dataDir), null);
  });
});

test("releases the acquired cohort when the first pause state write fails", async () => {
  await withDataDir(async (dataDir) => {
    await writeFile(path.join(dataDir, "admin"), "blocked");
    const now = new Date("2026-10-06T12:00:00.000Z");
    const operationId = "desktop-update-2026-10-06T12-00-00-000Z";
    const calls = [];
    let identityCalls = 0;
    const client = {
      acquire: async () => ({
        barrier: [{ hostId: "local" }, { hostId: "ncdata" }],
      }),
      status: async () => ({ lease: lease("draining", operationId) }),
      identity: async () => {
        identityCalls += 1;
        return {
          connectedHostIds:
            identityCalls === 1 ? ["local"] : ["local", "ncdata"],
        };
      },
      release: async (_operationId, resolution) => calls.push(resolution),
    };
    await assert.rejects(
      pauseWork(
        client,
        { dataDir, previous: "p", candidate: "c", now },
        fastTiming,
      ),
      /EEXIST/u,
    );
    assert.deepEqual(calls, ["force-aborted"]);
    assert.equal(identityCalls, 2);
  });
});

test("releases the sealed cohort when the second pause state write fails", async () => {
  await withDataDir(async (dataDir) => {
    const now = new Date("2026-10-06T12:00:00.000Z");
    const operationId = "desktop-update-2026-10-06T12-00-00-000Z";
    const calls = [];
    let identityCalls = 0;
    const client = {
      acquire: async () => ({ barrier: [{ hostId: "local" }] }),
      seal: async () => {
        await rm(path.join(dataDir, "admin"), { recursive: true, force: true });
        await writeFile(path.join(dataDir, "admin"), "blocked");
        return { barrier: [{ hostId: "local" }, { hostId: "ncdata" }] };
      },
      status: async () => ({ lease: lease("sealed", operationId) }),
      identity: async () => {
        identityCalls += 1;
        return {
          connectedHostIds:
            identityCalls === 1 ? ["local"] : ["local", "ncdata"],
        };
      },
      transition: async () => calls.push("transition"),
      release: async (_operationId, resolution) => calls.push(resolution),
    };
    await assert.rejects(
      pauseWork(
        client,
        { dataDir, previous: "p", candidate: "c", now },
        fastTiming,
      ),
      /EEXIST/u,
    );
    assert.deepEqual(calls, ["transition", "force-aborted"]);
    assert.equal(identityCalls, 2);
  });
});

test("keeps the pause state write error and recovery guidance when cleanup fails", async () => {
  await withDataDir(async (dataDir) => {
    await writeFile(path.join(dataDir, "admin"), "blocked");
    const now = new Date("2026-10-06T12:00:00.000Z");
    const operationId = "desktop-update-2026-10-06T12-00-00-000Z";
    const client = {
      acquire: async () => ({ barrier: [{ hostId: "local" }] }),
      status: async () => ({ lease: lease("draining", operationId) }),
      identity: async () => ({ connectedHostIds: ["local"] }),
      release: async () => {
        throw new Error("release refused");
      },
    };
    await assert.rejects(
      pauseWork(
        client,
        { dataDir, previous: "p", candidate: "c", now },
        fastTiming,
      ),
      /EEXIST[\s\S]*Also could not release the pause[\s\S]*release refused[\s\S]*maintenance --data-dir/u,
    );
  });
});

test("prints recovery commands with the absolute CLI path and operation id only", () => {
  const text = recoveryInstructions({
    cli: installedBbLocalCli,
    dataDir: "/data/bb",
    operationId: "desktop-update-x",
    backupApp: "/Trash/backup.app",
  });
  assert.match(text, /pnpm desktop:local:update --recover/u);
  assert.ok(
    text.includes(
      `"${installedBbLocalCli}" maintenance --data-dir "/data/bb" transition desktop-update-x sealed releasing`,
    ),
  );
  assert.ok(
    text.includes(
      `"${installedBbLocalCli}" maintenance --data-dir "/data/bb" release desktop-update-x --resolution force-aborted`,
    ),
  );
  assert.match(text, /\/Trash\/backup\.app/u);
  assert.doesNotMatch(
    recoveryInstructions({
      cli: installedBbLocalCli,
      dataDir: "/data/bb",
      operationId: "desktop-update-x",
      backupApp: null,
    }),
    /previous app/u,
  );
});

test("a real SIGTERM sent only to the updater process still releases the pause", async () => {
  const moduleUrl = pathToFileURL(
    path.join(process.cwd(), "scripts", "update-local-desktop.fork.mjs"),
  ).href;
  const code = `
import fs from "node:fs";
const m = await import(${JSON.stringify(moduleUrl)});
m.installSignalHandlers();
const out = (line) => fs.writeSync(1, line + "\\n");
const steps = {
  pause: async () => ({ operationId: "desktop-update-x" }),
  quit: async () => out("quit"),
  build: async () => {
    out("building");
    m.run("/bin/sleep", ["1.5"]);
  },
  swap: async () => out("swap"),
  syncPlugins: async () => out("plugins"),
  recoverLocal: async () => out("recover-local"),
  release: async (resolution) => out("release:" + resolution),
  recoveryText: () => "recovery",
  throwIfInterrupted: m.throwIfInterrupted,
  beginCleanup: m.beginCleanup,
};
try {
  await m.runPausedUpdate(steps);
  out("done");
} catch (error) {
  out("error:" + error.message);
}
`;
  const childEnvironment = { ...process.env };
  delete childEnvironment.BB_THREAD_ID;
  delete childEnvironment.BB_TERMINAL_SESSION_ID;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    env: childEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let signalled = false;
  const finished = new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (!signalled && output.includes("building\n")) {
        signalled = true;
        child.kill("SIGTERM");
      }
    });
    child.on("error", reject);
    child.on("close", resolve);
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
  try {
    await finished;
  } finally {
    clearTimeout(timer);
  }
  assert.equal(
    output,
    "quit\nbuilding\nrecover-local\nrelease:force-aborted\nerror:interrupted by SIGTERM\n",
  );
});

async function signalledNotices({ resetFirst }) {
  const moduleUrl = pathToFileURL(
    path.join(process.cwd(), "scripts", "update-local-desktop.fork.mjs"),
  ).href;
  const code = `
import fs from "node:fs";
const m = await import(${JSON.stringify(moduleUrl)});
m.installSignalHandlers();
m.setInterruptRecoveryText("RECOVERY-TEXT --recover");
m.beginPostReleaseInterrupts();
if (${JSON.stringify(resetFirst)}) m.resetInterruption();
fs.writeSync(1, "ready\\n");
setInterval(() => {}, 1000);
`;
  const childEnvironment = { ...process.env };
  delete childEnvironment.BB_THREAD_ID;
  delete childEnvironment.BB_TERMINAL_SESSION_ID;
  delete childEnvironment.NODE_OPTIONS;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    env: childEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  let signals = 0;
  const finished = new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      if (signals === 0 && String(chunk).includes("ready")) {
        signals = 1;
        child.kill("SIGTERM");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (signals === 1 && stderr.includes("\n")) {
        signals = 2;
        child.kill("SIGTERM");
      }
    });
    child.on("error", reject);
    child.on("close", resolve);
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
  let finishedCode;
  try {
    finishedCode = await finished;
  } finally {
    clearTimeout(timer);
  }
  const lines = stderr.split("\n");
  return { code: finishedCode, lines, stderr };
}

test("after the update is applied a signal says so and carries no recovery text", async () => {
  const { code, lines, stderr } = await signalledNotices({ resetFirst: false });
  assert.ok(
    lines.includes(
      "Received SIGTERM; the bb update is already applied; stopping (send it again to exit immediately)",
    ),
  );
  assert.ok(lines.includes("Received SIGTERM again; exiting now."));
  assert.ok(!stderr.includes("--recover"));
  assert.ok(!stderr.includes("RECOVERY-TEXT"));
  assert.equal(code, 130);
});

test("resetting the interruption state restores the pause release notice", async () => {
  const { code, lines, stderr } = await signalledNotices({ resetFirst: true });
  assert.ok(
    lines.includes(
      "Received SIGTERM; stopping and releasing the update pause (send it again to exit immediately)",
    ),
  );
  assert.ok(lines.includes("Received SIGTERM again; exiting now."));
  assert.ok(!stderr.includes("--recover"));
  assert.equal(code, 130);
});

test("matches only the bb Local main process when checking whether it runs", () => {
  const pattern = new RegExp(localMainProcessPattern, "u");
  assert.ok(pattern.test("/Applications/bb Local.app/Contents/MacOS/bb Local"));
  assert.ok(
    !pattern.test(
      "/Applications/bb Local.app/Contents/MacOS/bb Local /Applications/bb Local.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/daemon-bundle.mjs",
    ),
  );
  assert.ok(
    !pattern.test(
      "/Applications/bb Local.app/Contents/MacOS/bb Local --type=x",
    ),
  );
});

test("gives up waiting for bb Local health after the deadline", async () => {
  await assert.rejects(
    waitForLocalServerHealth(
      "bb Local app",
      "^bb-updater-test-no-such-process$",
      0,
    ),
    /bb Local app did not become healthy at http:\/\/127\.0\.0\.1:\d+\/health within 0 seconds/u,
  );
});

test("waits for the target process before accepting local health", async (t) => {
  const processPattern = `bb-updater-health-${process.pid}-${Date.now()}`;
  let processStarted = false;
  let healthyResponses = 0;
  let child = null;
  t.after(() => child?.kill());
  t.mock.method(globalThis, "fetch", async () => {
    healthyResponses += 1;
    if (!processStarted) {
      processStarted = true;
      child = spawn(process.execPath, [
        "-e",
        "setInterval(() => {}, 1_000)",
        processPattern,
      ]);
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
    }
    return { ok: true, json: async () => ({ ok: true }) };
  });
  await waitForLocalServerHealth("bb Local app", processPattern, 1_000);
  assert.equal(healthyResponses, 2);
});

test("an interrupted seal still releases the lease with checks disabled and reports recovery when that fails", async () => {
  await withDataDir(async (dataDir) => {
    const now = new Date("2026-10-06T12:00:00.000Z");
    const operationId = "desktop-update-2026-10-06T12-00-00-000Z";
    const interruptedSeal = async () => {
      requestInterrupt("SIGTERM");
      throw new Error("interrupted by SIGTERM");
    };
    const client = fakeClient({ phase: "sealed", operationId });
    client.acquire = async () => ({ barrier: [{ hostId: "local" }] });
    client.seal = interruptedSeal;
    await assert.rejects(
      pauseWork(
        client,
        { dataDir, previous: "p", candidate: "c", now },
        fastTiming,
      ),
      (error) => error.message === "interrupted by SIGTERM",
    );
    assert.deepEqual(client.calls, [
      "transition sealed->releasing",
      "release force-aborted",
    ]);
    assert.equal(await readUpdateState(dataDir), null);

    resetInterruption();
    const stuck = fakeClient({
      phase: "sealed",
      operationId,
      releaseFailures: 1,
      releaseError: "BB maintenance request failed with HTTP 400: nope",
    });
    stuck.acquire = async () => ({ barrier: [{ hostId: "local" }] });
    stuck.seal = interruptedSeal;
    await assert.rejects(
      pauseWork(
        stuck,
        { dataDir, previous: "p", candidate: "c", now },
        fastTiming,
      ),
      new RegExp(
        `interrupted by SIGTERM[\\s\\S]*Also could not release the pause[\\s\\S]*nope[\\s\\S]*maintenance --data-dir[\\s\\S]*release ${operationId}`,
        "u",
      ),
    );
  });
});

test("an interrupted acquire releases a lease the server may already hold", async () => {
  await withDataDir(async (dataDir) => {
    const operationId = "desktop-update-2026-10-06T12-00-00-000Z";
    const client = fakeClient({ phase: "draining", operationId });
    client.acquire = async () => {
      requestInterrupt("SIGHUP");
      throw new Error("interrupted by SIGHUP");
    };
    await assert.rejects(
      pauseWork(
        client,
        {
          dataDir,
          previous: "p",
          candidate: "c",
          now: new Date("2026-10-06T12:00:00.000Z"),
        },
        fastTiming,
      ),
      (error) => error.message === "interrupted by SIGHUP",
    );
    assert.deepEqual(client.calls, ["release force-aborted"]);
  });
});

test("says the release failed, not that hosts are missing, when every paused host is connected", async () => {
  const stuck = fakeClient({ releaseFailures: 1_000 });
  await assert.rejects(
    releaseLease(stuck, { ...cohort, resolution: "completed" }, fastTiming),
    (error) =>
      /bb maintenance status/u.test(error.message) &&
      !/did not reconnect/u.test(error.message),
  );
});

test("a failed final release says the fork push was skipped", async () => {
  await assert.rejects(
    runPausedUpdate(
      pausedSteps([], {
        release: async () => {
          throw new Error("release failed");
        },
      }),
    ),
    /release failed[\s\S]*RECOVERY[\s\S]*push was skipped/u,
  );
});

test("keeps recovery usable when the state file is unreadable or the lease is foreign", async () => {
  await withDataDir(async (dataDir) => {
    await mkdir(path.dirname(updateStatePath(dataDir)), { recursive: true });
    await writeFile(updateStatePath(dataDir), "not json");
    await assert.rejects(
      recoverLeftoverLease(
        fakeClient({ phase: "sealed" }),
        { dataDir, hasOwnerFile: async () => true, during: "recover" },
        fastTiming,
      ),
      /operation desktop-update-x[\s\S]*missing or unreadable[\s\S]*maintenance --data-dir[\s\S]*transition desktop-update-x sealed releasing[\s\S]*release desktop-update-x/u,
    );
    await assert.rejects(
      recoverLeftoverLease(
        fakeClient({ operationId: "vps-update-1" }),
        { dataDir, hasOwnerFile: async () => true, during: "recover" },
        fastTiming,
      ),
      (error) =>
        /status[\s\S]*docs\/linux-arm64-vps\.md[\s\S]*run --recover again/u.test(
          error.message,
        ) && !/before updating/u.test(error.message),
    );
    await assert.rejects(
      recoverLeftoverLease(
        fakeClient({ operationId: "vps-update-1" }),
        { dataDir, hasOwnerFile: async () => true },
        fastTiming,
      ),
      /run the update again/u,
    );
  });
});

function installHarness(
  dataDir,
  { fail = {}, hostIds = ["local", "ncdata"] } = {},
) {
  const events = [];
  let phase = null;
  let operationId = null;
  const barrier = hostIds.map((hostId) => ({ hostId }));
  const client = {
    identity: async () => ({ connectedHostIds: hostIds }),
    status: async () => ({
      lease:
        phase === null
          ? null
          : { operationId, phase, reason: "desktop local update" },
    }),
    acquire: async (id) => {
      operationId = id;
      phase = "draining";
      events.push("acquire");
      return { barrier };
    },
    seal: async () => {
      phase = "sealed";
      events.push("seal");
      return { barrier, activity: { activeByKind: {} } };
    },
    transition: async (id, expected, next) => {
      phase = next;
      events.push(`transition:${expected}->${next}`);
    },
    release: async (id, resolution) => {
      phase = null;
      events.push(`release:${resolution}`);
    },
  };
  const step =
    (name) =>
    async (...args) => {
      events.push(name);
      if (fail[name]) throw new Error(fail[name]);
      return args;
    };
  const actions = {
    installApp: async (backup) => {
      events.push("install");
      const state = await readUpdateState(dataDir);
      events.push(`state-backup:${state.backupApp === backup}`);
      if (fail.install) throw new Error(fail.install);
    },
    startLocal: step("start-local"),
    stopLocal: step("stop-local"),
    restoreBackup: async (backup) => {
      const state = await readUpdateState(dataDir);
      events.push(`restore:${state.backupApp === backup}`);
    },
    ensureLocalRunning: step("ensure-local-running"),
    ensureOfficialStopped: step("ensure-official-stopped"),
  };
  return {
    events,
    run: () =>
      runInstallUpdate({
        client,
        dataDir,
        upstreamRef: null,
        options: { plugins: true },
        build: step("build"),
        syncPlugins: step("sync-plugins"),
        actions,
      }),
  };
}

test("install flow records the backup before swapping and resumes after plugins", async () => {
  await withDataDir(async (dataDir) => {
    const harness = installHarness(dataDir);
    await harness.run();
    assert.deepEqual(harness.events, [
      "acquire",
      "seal",
      "stop-local",
      "build",
      "ensure-official-stopped",
      "install",
      "state-backup:true",
      "ensure-official-stopped",
      "start-local",
      "sync-plugins",
      "ensure-official-stopped",
      "transition:sealed->releasing",
      "release:completed",
    ]);
    assert.equal(await readUpdateState(dataDir), null);
  });
});

test("install flow restores the backup and force-aborts when the new app is unhealthy", async () => {
  await withDataDir(async (dataDir) => {
    const harness = installHarness(dataDir, {
      fail: { "start-local": "new app unhealthy" },
    });
    await assert.rejects(
      harness.run(),
      (error) => error.message === "new app unhealthy",
    );
    assert.deepEqual(harness.events.slice(harness.events.indexOf("install")), [
      "install",
      "state-backup:true",
      "ensure-official-stopped",
      "start-local",
      "stop-local",
      "restore:true",
      "ensure-local-running",
      "ensure-official-stopped",
      "transition:sealed->releasing",
      "release:force-aborted",
    ]);
  });
});

test("install flow does not restore when the install rolled itself back", async () => {
  await withDataDir(async (dataDir) => {
    const harness = installHarness(dataDir, {
      fail: { install: "ditto failed" },
    });
    await assert.rejects(
      harness.run(),
      (error) => error.message === "ditto failed",
    );
    assert.deepEqual(harness.events.slice(harness.events.indexOf("install")), [
      "install",
      "state-backup:true",
      "ensure-local-running",
      "ensure-official-stopped",
      "transition:sealed->releasing",
      "release:force-aborted",
    ]);
  });
});

test("install flow keeps the lease and prints the backup when the restored app also fails", async () => {
  await withDataDir(async (dataDir) => {
    const harness = installHarness(dataDir, {
      fail: {
        "start-local": "new app unhealthy",
        "ensure-local-running": "restored app unhealthy",
      },
    });
    await assert.rejects(
      harness.run(),
      /new app unhealthy[\s\S]*Also: restored app unhealthy[\s\S]*desktop-update-[\s\S]*bb-local-backup-/u,
    );
    assert.ok(!harness.events.some((event) => event.startsWith("release")));
    assert.notEqual(await readUpdateState(dataDir), null);
  });
});

test("install flow force-aborts after a plugin sync failure without touching the app", async () => {
  await withDataDir(async (dataDir) => {
    const harness = installHarness(dataDir, {
      fail: { "sync-plugins": "plugin sync failed" },
    });
    await assert.rejects(
      harness.run(),
      (error) => error.message === "plugin sync failed",
    );
    assert.ok(!harness.events.some((event) => event.startsWith("restore")));
    assert.equal(harness.events.at(-1), "release:force-aborted");
  });
});
