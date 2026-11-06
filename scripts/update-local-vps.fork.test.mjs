import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import test from "node:test";
import {
  FLOCK_CONTENTION_STATUS,
  VPS_NODE_ENGINE,
  VPS_UPDATE_EXIT_CODES,
  VpsUpdateError,
  activateBootstrapRelease,
  activateVpsRelease,
  asVpsRecoveryError,
  assertCurrentReleaseTarget,
  assertCandidateNativeArchitecture,
  assertOperationDataDir,
  assertRuntimeReleaseIdentity,
  assertServiceProcessRelease,
  assertSupportedHost,
  assertSupportedVpsNode,
  assertPushBranch,
  buildSandboxCommand,
  candidateBuildCommands,
  candidateCommandNeedsNetwork,
  createMaintenanceAdminClient,
  matchesPackageManagerVersion,
  parseVpsUpdateArgs,
  parseStoredDataDir,
  resolveExplicitVpsCli,
  recoverCandidateBuild,
  recoverVpsRelease,
  resolveVpsDataDir,
  satisfiesNodeEngine,
  syncVpsPlugins,
  syncVpsPluginsOnly,
  validateCandidateFetchInputs,
  validateOwnedVpsRelease,
  waitForServiceProcessRelease,
} from "./update-local-vps.fork.mjs";

test("pure: VPS entrypoints and implementations import without effects", async () => {
  const [
    canonicalInstaller,
    forkInstaller,
    canonicalUpdater,
    forkUpdater,
  ] = await Promise.all([
    import("./install-local-vps-service.mjs"),
    import("./install-local-vps-service.fork.mjs"),
    import("./update-local-vps.mjs"),
    import("./update-local-vps.fork.mjs"),
  ]);

  assert.deepEqual(Object.keys(canonicalInstaller), []);
  assert.equal(typeof forkInstaller.installLocalVpsService, "function");
  assert.deepEqual(Object.keys(canonicalUpdater), []);
  assert.equal(typeof forkUpdater.runUnderFlock, "function");
});

test("pure: supports only Linux arm64", () => {
  assert.doesNotThrow(() => assertSupportedHost("linux", "arm64"));
  assert.throws(() => assertSupportedHost("linux", "x64"), /Linux arm64 only/u);
  assert.throws(
    () => assertSupportedHost("darwin", "arm64"),
    /Linux arm64 only/u,
  );
});

test("pure: validates the packaged runtime native addon architecture", () => {
  const releaseDir = path.join(path.sep, "srv", "bb", "release");
  let inspectedPath = null;
  assert.doesNotThrow(() =>
    assertCandidateNativeArchitecture(releaseDir, (command, args, options) => {
      assert.equal(command, "file");
      assert.deepEqual(options, { capture: true });
      inspectedPath = args[0];
      return { stdout: "ELF 64-bit LSB shared object, ARM aarch64" };
    }),
  );
  assert.equal(
    inspectedPath,
    path.join(
      releaseDir,
      "packages",
      "bb-app",
      "node_modules",
      "better-sqlite3",
      "build",
      "Release",
      "better_sqlite3.node",
    ),
  );
  assert.throws(
    () =>
      assertCandidateNativeArchitecture(releaseDir, () => ({
        stdout: "ELF 64-bit LSB shared object, x86-64",
      })),
    /candidate native dependency is not ARM64/u,
  );
});

test("pure: pushes only the configured fork branch", () => {
  assert.doesNotThrow(() => assertPushBranch("main", "main", true));
  assert.doesNotThrow(() => assertPushBranch("feature", "main", false));
  assert.throws(
    () => assertPushBranch("feature", "main", true),
    /refusing to push branch feature over main/u,
  );
});

test("pure: reads quoted service data directories including spaces", () => {
  assert.equal(parseStoredDataDir('"/srv/bb data"'), "/srv/bb data");
  assert.equal(parseStoredDataDir("/srv/legacy"), "/srv/legacy");
});

test("fixture: keeps updater and installed service data directories aligned", async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "bb-vps-home-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const configDir = path.join(homeDir, ".config", "bb-local");
  const serviceDataDir = path.join(homeDir, "bb data");
  const serviceDataDirLink = path.join(homeDir, "service data");
  const otherDataDir = path.join(homeDir, "other data");
  await mkdir(configDir, { recursive: true });
  await mkdir(serviceDataDir, { recursive: true });
  await mkdir(otherDataDir, { recursive: true });
  await symlink(serviceDataDir, serviceDataDirLink);
  const canonicalServiceDataDir = await realpath(serviceDataDir);
  await writeFile(
    path.join(configDir, "environment"),
    `BB_DATA_DIR=${JSON.stringify(serviceDataDirLink)}\n`,
  );

  assert.equal(
    await resolveVpsDataDir({}, homeDir, {}),
    canonicalServiceDataDir,
  );
  assert.equal(
    await resolveVpsDataDir({ dataDir: serviceDataDirLink }, homeDir, {}),
    canonicalServiceDataDir,
  );
  await assert.rejects(
    resolveVpsDataDir({ dataDir: otherDataDir }, homeDir, {}),
    /does not match the installed service directory/u,
  );
  await rm(serviceDataDirLink);
  await symlink(otherDataDir, serviceDataDirLink);
  await assert.rejects(
    resolveVpsDataDir({ dataDir: serviceDataDir }, homeDir, {}),
    /does not match the installed service directory/u,
  );
});

test("pure: enforces both supported Node majors and the minimum patch", () => {
  const engine = "^22.19.0 || ^24.0.0 || ^26.0.0";
  assert.equal(satisfiesNodeEngine("22.19.0", engine), true);
  assert.equal(satisfiesNodeEngine("24.3.1", engine), true);
  assert.equal(satisfiesNodeEngine("26.0.0", engine), true);
  assert.equal(satisfiesNodeEngine("22.18.9", engine), false);
  assert.equal(satisfiesNodeEngine("23.0.0", engine), false);
  assert.equal(satisfiesNodeEngine("25.0.0", engine), false);
  assert.equal(satisfiesNodeEngine("27.0.0", engine), false);
  assert.equal(satisfiesNodeEngine("24.0", engine), false);
});

test("pure: pins Linux arm64 VPS releases to the Node 22 line", () => {
  assert.equal(VPS_NODE_ENGINE, "^22.19.0");
  assert.doesNotThrow(() => assertSupportedVpsNode("22.19.0"));
  assert.doesNotThrow(() => assertSupportedVpsNode("22.23.2"));
  assert.throws(
    () => assertSupportedVpsNode("22.18.9"),
    /must satisfy \^22\.19\.0/u,
  );
  assert.throws(
    () => assertSupportedVpsNode("24.21.0"),
    /must satisfy \^22\.19\.0/u,
  );
  assert.throws(
    () => assertSupportedVpsNode("26.0.0"),
    /must satisfy \^22\.19\.0/u,
  );
});

test("pure: requires the exact repository pnpm version", () => {
  assert.equal(matchesPackageManagerVersion("9.15.0", "pnpm@9.15.0"), true);
  assert.equal(matchesPackageManagerVersion("9.14.4", "pnpm@9.15.0"), false);
  assert.equal(matchesPackageManagerVersion("9.16.0", "pnpm@9.15.0"), false);
  assert.equal(
    matchesPackageManagerVersion("9.15.0-dev", "pnpm@9.15.0"),
    false,
  );
});

test("pure: requires the authenticated runtime to identify the selected release", () => {
  assert.doesNotThrow(() =>
    assertRuntimeReleaseIdentity(
      {
        service: "bb-maintenance",
        protocolVersion: 2,
        releaseIdentity: "/srv/releases/abc",
        connectedHostIds: ["host-1"],
      },
      "/srv/releases/abc",
      ["host-1"],
    ),
  );
  assert.throws(
    () =>
      assertRuntimeReleaseIdentity(
        {
          service: "bb-maintenance",
          protocolVersion: 2,
          releaseIdentity: "/srv/releases/stale",
          connectedHostIds: ["host-1"],
        },
        "/srv/releases/abc",
      ),
    /does not match/u,
  );
  assert.throws(
    () =>
      assertRuntimeReleaseIdentity(
        {
          service: "bb-maintenance",
          protocolVersion: 2,
          releaseIdentity: "/srv/releases/abc",
          connectedHostIds: [],
        },
        "/srv/releases/abc",
        ["host-1"],
      ),
    /missing expected host daemons/u,
  );
  assert.throws(
    () =>
      assertRuntimeReleaseIdentity(
        {
          service: "bb-maintenance",
          protocolVersion: 2,
          releaseIdentity: "/srv/releases/abc",
          connectedHostIds: [],
        },
        "/srv/releases/abc",
        [],
        true,
      ),
    /no connected host daemon/u,
  );
  assert.throws(
    () =>
      assertRuntimeReleaseIdentity(
        {
          service: "bb-maintenance",
          protocolVersion: 1,
          releaseIdentity: "/srv/releases/abc",
          connectedHostIds: ["host-1"],
        },
        "/srv/releases/abc",
      ),
    /does not implement maintenance protocol 2/u,
  );
});

test("pure: requires the systemd main process to run from the selected release", () => {
  assert.doesNotThrow(() =>
    assertServiceProcessRelease("/srv/releases/abc", "/srv/releases/abc"),
  );
  assert.throws(
    () =>
      assertServiceProcessRelease("/srv/releases/stale", "/srv/releases/abc"),
    /does not match/u,
  );
});

test("pure: waits for systemd's executor to enter the selected release", async () => {
  const expectedRelease = "/srv/releases/abc";
  const processDirectories = ["/", expectedRelease];
  let clock = 0;
  let processIndex = 0;
  await waitForServiceProcessRelease(expectedRelease, {
    execute(command, args, options) {
      assert.equal(command, "systemctl");
      assert.deepEqual(args, [
        "--user",
        "show",
        "bb-local.service",
        "--property",
        "MainPID",
        "--value",
      ]);
      assert.deepEqual(options, { capture: true, timeoutMs: 10_000 });
      return { stdout: processIndex === 0 ? "101" : "102" };
    },
    async resolveRealpath(processPath) {
      assert.equal(processPath, `/proc/${processIndex === 0 ? 101 : 102}/cwd`);
      return processDirectories[processIndex];
    },
    async wait(delayMs) {
      assert.equal(delayMs, 50);
      processIndex += 1;
      clock += delayMs;
    },
    now: () => clock,
    deadlineMs: 100,
  });
  assert.equal(processIndex, 1);
});

test("pure: requires current to retain the selected release target", () => {
  assert.doesNotThrow(() =>
    assertCurrentReleaseTarget("/srv/releases/abc", "/srv/releases/abc"),
  );
  assert.throws(
    () =>
      assertCurrentReleaseTarget("/srv/releases/stale", "/srv/releases/abc"),
    /does not match/u,
  );
});

test("fixture: uses the updater's Unix-socket client for maintenance secrets", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "bb-vps-admin-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const adminDir = path.join(dataDir, "admin");
  const socketPath = path.join(adminDir, "maintenance.sock");
  await mkdir(adminDir, { recursive: true });
  await writeFile(path.join(adminDir, "capability"), "capability-secret\n", {
    mode: 0o600,
  });
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({
        authorization: request.headers.authorization,
        body: chunks.length
          ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
          : null,
        url: request.url,
      });
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify(
          request.url === "/identity"
            ? {
                service: "bb-maintenance",
                protocolVersion: 2,
                releaseIdentity: "/srv/releases/abc",
                connectedHostIds: ["host-1"],
              }
            : { lease: null, barrier: [], activity: { activeByKind: {} } },
        ),
      );
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  const client = createMaintenanceAdminClient(dataDir, "owner-secret");
  try {
    assert.equal((await client.identity()).protocolVersion, 2);
    await client.release({ operationId: "op-1", resolution: "rolled-back" });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  assert.deepEqual(requests, [
    {
      authorization: "Bearer capability-secret",
      body: null,
      url: "/identity",
    },
    {
      authorization: "Bearer capability-secret",
      body: {
        operationId: "op-1",
        resolution: "rolled-back",
        ownerSecret: "owner-secret",
      },
      url: "/maintenance/release",
    },
  ]);
});

test("pure: maps every recovery failure to the documented exit code", () => {
  const ordinary = new Error("socket unavailable");
  const wrapped = asVpsRecoveryError(ordinary);
  assert.equal(wrapped.exitCode, 9);
  assert.equal(wrapped.cause, ordinary);

  const retained = new VpsUpdateError("retained", 9);
  assert.equal(asVpsRecoveryError(retained), retained);
  assert.equal(
    asVpsRecoveryError(new VpsUpdateError("contention", 4)).exitCode,
    9,
  );
});

test("pure: binds recovery to the operation's immutable data directory", () => {
  assert.doesNotThrow(() =>
    assertOperationDataDir({ dataDir: "/srv/bb" }, "/srv/bb"),
  );
  assert.throws(
    () => assertOperationDataDir({ dataDir: "/srv/old" }, "/srv/new"),
    /does not match the selected service directory/u,
  );
  assert.throws(
    () => assertOperationDataDir({}, "/srv/new"),
    /operation data directory undefined/u,
  );
});

test("pure: parses headless update modes without ambiguous restart behavior", () => {
  assert.deepEqual(parseVpsUpdateArgs([]), {
    allowActiveWork: false,
    bootstrap: false,
    check: false,
    dataDir: undefined,
    otherPlugins: true,
    plugins: true,
    pluginsOnly: false,
    push: true,
    recover: undefined,
    stageOnly: false,
    status: undefined,
  });
  assert.deepEqual(
    parseVpsUpdateArgs([
      "--",
      "--stage-only",
      "--skip-plugins",
      "--skip-push",
      "--allow-active-work",
      "--data-dir",
      "/srv/bb-data",
    ]),
    {
      allowActiveWork: true,
      bootstrap: false,
      check: false,
      dataDir: "/srv/bb-data",
      otherPlugins: true,
      plugins: false,
      pluginsOnly: false,
      push: false,
      recover: undefined,
      stageOnly: true,
      status: undefined,
    },
  );
  assert.deepEqual(parseVpsUpdateArgs(["--status", "op-1"]), {
    allowActiveWork: false,
    bootstrap: false,
    check: false,
    dataDir: undefined,
    otherPlugins: true,
    plugins: true,
    pluginsOnly: false,
    push: true,
    recover: undefined,
    stageOnly: false,
    status: "op-1",
  });
  assert.deepEqual(
    parseVpsUpdateArgs(["--plugins-only", "--data-dir", "/srv/bb-data"]),
    {
      allowActiveWork: false,
      bootstrap: false,
      check: false,
      dataDir: "/srv/bb-data",
      otherPlugins: true,
      plugins: true,
      pluginsOnly: true,
      push: true,
      recover: undefined,
      stageOnly: false,
      status: undefined,
    },
  );
  assert.equal(
    parseVpsUpdateArgs(["--plugins-only", "--skip-other-plugins"]).otherPlugins,
    false,
  );
  assert.equal(
    parseVpsUpdateArgs(["--skip-other-plugins", "--bootstrap"]).otherPlugins,
    false,
  );
  assert.throws(
    () => parseVpsUpdateArgs(["--plugins-only", "--check"]),
    /mutually exclusive/u,
  );
  for (const flag of ["--skip-plugins", "--skip-push", "--allow-active-work"]) {
    assert.throws(
      () => parseVpsUpdateArgs(["--plugins-only", flag]),
      new RegExp(`--plugins-only cannot be combined with ${flag}`, "u"),
    );
  }
  assert.throws(
    () => parseVpsUpdateArgs(["--skip-restart"]),
    /unknown argument/u,
  );
  assert.throws(
    () => parseVpsUpdateArgs(["--data-dir", "relative"]),
    /absolute path/u,
  );
});

test("pure: build sandbox hides production state and constrains candidate writes", () => {
  const command = buildSandboxCommand({
    operationId: "op-1",
    candidateDir: "/srv/releases/abc",
    cacheDir: "/srv/state/build-cache",
    dataDir: "/srv/data",
    toolPaths: ["/opt/node"],
    userRuntimeDir: "/run/user/1000",
    command: ["pnpm", "install", "--frozen-lockfile"],
  });
  assert.equal(command.executable, "systemd-run");
  assert.ok(command.args.includes("ProtectSystem=strict"));
  assert.ok(command.args.includes("ProtectHome=read-only"));
  assert.ok(command.args.includes("PrivateTmp=yes"));
  assert.ok(command.args.includes("PrivateUsers=yes"));
  assert.ok(command.args.includes("PrivateDevices=yes"));
  assert.ok(command.args.includes("PrivateNetwork=yes"));
  assert.ok(command.args.includes("ProtectProc=ptraceable"));
  assert.ok(command.args.includes("ProcSubset=pid"));
  assert.ok(command.args.includes("RestrictNamespaces=yes"));
  assert.ok(
    command.args.includes("RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6"),
  );
  assert.ok(command.args.includes("NoNewPrivileges=yes"));
  assert.ok(command.args.includes("RestrictSUIDSGID=yes"));
  assert.ok(command.args.includes("UMask=0077"));
  assert.ok(
    command.args.includes(
      'ReadWritePaths="/srv/releases/abc" "/srv/state/build-cache"',
    ),
  );
  assert.ok(
    command.args.includes(
      'BindPaths="/srv/releases/abc" "/srv/state/build-cache"',
    ),
  );
  assert.ok(command.args.includes('BindReadOnlyPaths="/opt/node"'));
  assert.ok(
    command.args.includes(
      'InaccessiblePaths="/srv/data" "/run/user/1000" "-/run/containerd" "-/run/dbus" "-/run/docker.sock" "-/run/podman" "-/var/run/docker.sock" "-/var/run/podman"',
    ),
  );
  assert.ok(
    command.args.includes(
      "PATH=/opt/node:/opt/node/bin:/usr/local/bin:/usr/bin:/bin",
    ),
  );
  assert.ok(
    command.args.includes("TURBO_CACHE_DIR=/srv/state/build-cache/turbo-cache"),
  );
  assert.ok(command.args.includes("npm_config_nodedir=/opt/node"));
  assert.deepEqual(command.args.slice(-3), [
    "pnpm",
    "install",
    "--frozen-lockfile",
  ]);

  const fetchCommand = buildSandboxCommand({
    operationId: "op-2",
    candidateDir: "/srv/releases/def",
    cacheDir: "/srv/state/build-cache",
    dataDir: "/srv/data",
    toolPaths: ["/opt/node"],
    userRuntimeDir: "/run/user/1000",
    network: true,
    command: ["pnpm", "fetch", "--ignore-scripts", "--ignore-pnpmfile"],
  });
  assert.ok(fetchCommand.args.includes("PrivateNetwork=no"));
  assert.ok(
    fetchCommand.args.includes(
      "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
    ),
  );
  assert.deepEqual(candidateBuildCommands("/srv/data").slice(0, 3), [
    ["/usr/bin/test", "!", "-r", "/srv/data/bb.db"],
    ["/usr/bin/test", "!", "-r", "/srv/data/admin/capability"],
    ["/usr/bin/test", "!", "-r", "/srv/data/admin/operations"],
  ]);

  const commands = candidateBuildCommands("/srv/data", "/srv/cache");
  const fetchIndex = commands.findIndex(
    (candidate) => candidate[0] === "pnpm" && candidate[1] === "fetch",
  );
  const smokeWarmIndex = commands.findIndex(
    (candidate) =>
      candidate[0] === "npm" &&
      candidate[1] === "install" &&
      candidate.includes("--install-links=true"),
  );
  const smokeIndex = commands.findIndex((candidate) =>
    candidate.includes("smoke:tarball"),
  );
  const firstExecutableIndex = commands.findIndex(
    (candidate) => candidate[0] === "pnpm" && candidate[1] === "install",
  );
  const nativeRebuildIndex = commands.findIndex(
    (candidate) =>
      candidate[0] === "pnpm" &&
      candidate.includes("rebuild") &&
      candidate.includes("better-sqlite3"),
  );
  assert.equal(candidateCommandNeedsNetwork(commands[fetchIndex]), true);
  assert.equal(nativeRebuildIndex, firstExecutableIndex + 1);
  assert.equal(
    candidateCommandNeedsNetwork(commands[nativeRebuildIndex]),
    false,
  );
  assert.ok(
    smokeWarmIndex > firstExecutableIndex && smokeWarmIndex < smokeIndex,
  );
  assert.ok(commands[smokeWarmIndex].includes("--ignore-scripts"));
  assert.ok(commands[smokeWarmIndex].includes("--package-lock=false"));
  assert.ok(
    commands[smokeWarmIndex].includes("--registry=https://registry.npmjs.org"),
  );
  assert.ok(commands[smokeWarmIndex].includes("--git=/usr/bin/false"));
  assert.equal(candidateCommandNeedsNetwork(commands[smokeWarmIndex]), true);
  assert.ok(
    commands[smokeIndex].includes("BB_APP_SMOKE_USE_WORKSPACE_ARTIFACTS=true"),
  );
  assert.ok(commands[smokeIndex].includes("npm_config_offline=true"));
  assert.ok(commands[smokeIndex].includes("npm_config_fetch_retries=0"));
  assert.ok(commands[smokeIndex].includes("npm_config_userconfig=/dev/null"));
  assert.equal(candidateCommandNeedsNetwork(commands[smokeIndex]), false);
});

test(
  "fixture: build sandbox enters a bound home-directory candidate",
  {
    skip:
      process.platform !== "linux" ||
      process.env.BB_VPS_SYSTEMD_INTEGRATION !== "1",
  },
  async () => {
    const homeDir = homedir();
    const candidateParent = path.join(homeDir, ".local", "share");
    const cacheParent = path.join(homeDir, ".local", "state");
    await Promise.all([
      mkdir(candidateParent, { recursive: true }),
      mkdir(cacheParent, { recursive: true }),
    ]);
    let candidateDir;
    let cacheDir;
    let dataDir;
    try {
      candidateDir = await mkdtemp(
        path.join(candidateParent, ".bb-vps-build-candidate-"),
      );
      cacheDir = await mkdtemp(path.join(cacheParent, ".bb-vps-build-cache-"));
      dataDir = await mkdtemp(path.join(homeDir, ".bb-vps-build-data-"));
      const nodeRoot = path.dirname(
        path.dirname(await realpath(process.execPath)),
      );
      const command = buildSandboxCommand({
        operationId: `integration-${process.pid}`,
        candidateDir,
        cacheDir,
        dataDir,
        toolPaths: [nodeRoot],
        userRuntimeDir: `/run/user/${process.getuid()}`,
        command: ["/usr/bin/pwd"],
      });
      const result = spawnSync(command.executable, command.args, {
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), candidateDir);
    } finally {
      await Promise.all(
        [candidateDir, cacheDir, dataDir]
          .filter((value) => value !== undefined)
          .map((value) => rm(value, { force: true, recursive: true })),
      );
    }
  },
);

test("fixture: candidate fetch inputs reject non-registry package config and locks", async (t) => {
  const candidateDir = await mkdtemp(path.join(tmpdir(), "bb-vps-fetch-"));
  t.after(() => rm(candidateDir, { recursive: true, force: true }));
  const safePnpmLock = [
    "lockfileVersion: '9.0'",
    "packages:",
    "  pkg@1.0.0:",
    "    resolution: {integrity: sha512-AAAA}",
    "",
  ].join("\n");
  await writeFile(path.join(candidateDir, "pnpm-lock.yaml"), safePnpmLock);

  assert.equal(await validateCandidateFetchInputs(candidateDir), undefined);

  await writeFile(
    path.join(candidateDir, ".npmrc"),
    "git=/tmp/candidate-git\n",
  );
  await assert.rejects(
    validateCandidateFetchInputs(candidateDir),
    /package-manager config is forbidden/u,
  );
  await rm(path.join(candidateDir, ".npmrc"));

  await writeFile(
    path.join(candidateDir, "pnpm-lock.yaml"),
    "packages:\n  pkg:\n    resolution: {repo: attacker/repo, type: git}\n",
  );
  await assert.rejects(
    validateCandidateFetchInputs(candidateDir),
    /non-registry dependency resolution/u,
  );
  await writeFile(
    path.join(candidateDir, "pnpm-lock.yaml"),
    'packages: {pkg: {"resolution": {tarball: "http://127.0.0.1:3000/pkg.tgz"}}}\n',
  );
  await assert.rejects(
    validateCandidateFetchInputs(candidateDir),
    /non-registry dependency resolution/u,
  );
});

test("fixture: recovery accepts only marked direct children of the release root", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "bb-vps-releases-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const releaseRoot = path.join(root, "releases");
  const valid = path.join(releaseRoot, "abc123");
  await mkdir(valid, { recursive: true });
  await writeFile(
    path.join(valid, ".bb-vps-release.json"),
    JSON.stringify({ commit: "abc123", complete: true }),
  );

  await expectRelease(valid);
  await assert.rejects(
    validateOwnedVpsRelease(releaseRoot, root),
    /outside the owned release root/u,
  );

  const mismatched = path.join(releaseRoot, "def456");
  await mkdir(mismatched);
  await writeFile(
    path.join(mismatched, ".bb-vps-release.json"),
    JSON.stringify({ commit: "other", complete: true }),
  );
  await assert.rejects(
    validateOwnedVpsRelease(releaseRoot, mismatched),
    /marker does not match/u,
  );

  const linked = path.join(releaseRoot, "linked");
  await symlink(valid, linked);
  await assert.rejects(
    validateOwnedVpsRelease(releaseRoot, linked),
    /not an owned directory/u,
  );

  async function expectRelease(target) {
    assert.equal(await validateOwnedVpsRelease(releaseRoot, target), target);
  }
});

test("fixture: recovery removes only an operation-owned incomplete candidate", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "bb-vps-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const releaseRoot = path.join(root, "releases");
  const updatesDir = path.join(root, "updates");
  const operationId = "op-1";
  const commit = "a".repeat(40);
  const releaseDir = path.join(releaseRoot, commit);
  const ownerPath = path.join(updatesDir, `${operationId}.candidate`);
  await mkdir(releaseDir, { recursive: true });
  await mkdir(updatesDir, { recursive: true });
  await writeFile(path.join(releaseDir, "partial"), "incomplete");
  await writeFile(
    ownerPath,
    JSON.stringify({ operationId, commit, releaseDir }),
    { mode: 0o600 },
  );
  const removed = [];

  assert.equal(
    await recoverCandidateBuild(
      { releaseRoot, operationId, ownerPath },
      {
        async removeCandidate(target) {
          removed.push(target);
          await rm(target, { recursive: true, force: true });
        },
      },
    ),
    true,
  );
  assert.deepEqual(removed, [releaseDir]);
  await assert.rejects(lstat(releaseDir), { code: "ENOENT" });
  await assert.rejects(lstat(ownerPath), { code: "ENOENT" });
});

test("fixture: recovery preserves candidates when the ownership marker is forged", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "bb-vps-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const releaseRoot = path.join(root, "releases");
  const updatesDir = path.join(root, "updates");
  const commit = "a".repeat(40);
  const releaseDir = path.join(releaseRoot, commit);
  const ownerPath = path.join(updatesDir, "op-1.candidate");
  await mkdir(releaseDir, { recursive: true });
  await mkdir(updatesDir, { recursive: true });
  await writeFile(
    ownerPath,
    JSON.stringify({
      operationId: "other-operation",
      commit,
      releaseDir,
    }),
    { mode: 0o600 },
  );

  await assert.rejects(
    recoverCandidateBuild({ releaseRoot, operationId: "op-1", ownerPath }),
    /owner file is invalid/u,
  );
  assert.equal((await lstat(releaseDir)).isDirectory(), true);
});

function activationHarness({
  activity = {},
  activeWorkConfirmed,
  sealFailure,
  verifyFailure,
  rollbackFailure,
  releaseFailure,
  pluginFailure,
  transitionFailure,
} = {}) {
  const calls = [];
  let currentPhase = "draining";
  const admin = {
    async acquire() {
      calls.push("acquire");
      return {
        lease: { phase: "draining" },
        barrier: [{ hostId: "host-1", state: "quiesced", error: null }],
        activity: { activeByKind: activity },
        replayed: false,
      };
    },
    async seal() {
      calls.push("seal");
      if (sealFailure) throw sealFailure;
      currentPhase = "sealed";
      return { lease: { phase: currentPhase } };
    },
    async transition(input) {
      calls.push(`transition:${input.phase}`);
      if (transitionFailure === input.phase) {
        throw new Error(`${input.phase} unavailable`);
      }
      currentPhase = input.phase;
    },
    async status() {
      calls.push("status");
      return { lease: { phase: currentPhase } };
    },
    async release(input) {
      calls.push(`release:${input.resolution}`);
      if (releaseFailure) throw releaseFailure;
    },
  };
  return {
    calls,
    admin,
    runtime: {
      async confirmActiveWork(entries) {
        calls.push(
          `confirm:${entries.map(([kind, count]) => `${kind}=${count}`).join(",")}`,
        );
        return activeWorkConfirmed ?? false;
      },
      async switchCurrent(target) {
        calls.push(`switch:${target}`);
      },
      async restart() {
        calls.push("restart");
      },
      async waitForAdmin() {},
      async verify(identity) {
        calls.push(`verify:${identity}`);
        if (identity === "candidate" && verifyFailure) throw verifyFailure;
        if (identity === "previous" && rollbackFailure) throw rollbackFailure;
      },
      async installPlugins() {
        calls.push("plugins");
        if (pluginFailure) throw pluginFailure;
      },
    },
  };
}

const activation = {
  operationId: "op-1",
  ownerSecret: "secret",
  reason: "update",
  ttlMs: 60_000,
  candidateRelease: "candidate",
  previousRelease: "previous",
  allowActiveWork: false,
  plugins: true,
};

test("pure: active work discovered after the barrier prevents sealing and restart", async () => {
  const harness = activationHarness({ activity: { "thread.start": 1 } });
  await assert.rejects(
    activateVpsRelease(activation, harness),
    (error) => error instanceof VpsUpdateError && error.exitCode === 5,
  );
  assert.deepEqual(harness.calls, ["acquire", "release:force-aborted"]);
});

test("pure: the service cannot restart until the fail-closed seal succeeds", async () => {
  const harness = activationHarness({ sealFailure: new Error("seal failed") });
  await assert.rejects(
    activateVpsRelease(activation, harness),
    (error) => error instanceof VpsUpdateError && error.exitCode === 6,
  );
  assert.deepEqual(harness.calls, ["acquire", "seal"]);
});

test("pure: break-glass active work requires exact operator confirmation", async () => {
  const refused = activationHarness({
    activity: { terminals: 2, threads: 1 },
  });
  await assert.rejects(
    activateVpsRelease({ ...activation, allowActiveWork: true }, refused),
    (error) => error instanceof VpsUpdateError && error.exitCode === 5,
  );
  assert.deepEqual(refused.calls, [
    "acquire",
    "confirm:terminals=2,threads=1",
    "release:force-aborted",
  ]);

  const accepted = activationHarness({
    activity: { terminals: 2, threads: 1 },
    activeWorkConfirmed: true,
  });
  await activateVpsRelease({ ...activation, allowActiveWork: true }, accepted);
  assert.ok(accepted.calls.includes("seal"));
  assert.ok(accepted.calls.includes("restart"));
});

test("pure: candidate failure rolls back while maintenance remains sealed", async () => {
  const harness = activationHarness({
    verifyFailure: new Error("candidate dead"),
  });
  await assert.rejects(
    activateVpsRelease(activation, harness),
    (error) => error instanceof VpsUpdateError && error.exitCode === 7,
  );
  assert.deepEqual(harness.calls, [
    "acquire",
    "seal",
    "transition:activating",
    "switch:candidate",
    "restart",
    "transition:verifying",
    "verify:candidate",
    "switch:previous",
    "restart",
    "verify:previous",
    "transition:rolling-back",
    "release:rolled-back",
  ]);
});

test("pure: waits for the restarted admin socket before entering verification", async () => {
  const harness = activationHarness();
  harness.runtime.waitForAdmin = async (identity) => {
    harness.calls.push(`wait-for-admin:${identity}`);
  };
  await activateVpsRelease(activation, harness);
  assert.deepEqual(harness.calls.slice(2, 8), [
    "transition:activating",
    "switch:candidate",
    "restart",
    "wait-for-admin:candidate",
    "transition:verifying",
    "verify:candidate",
  ]);
});

test("pure: candidate admin failure cannot prevent restoring the previous release", async () => {
  const harness = activationHarness({ transitionFailure: "verifying" });
  await assert.rejects(
    activateVpsRelease(activation, harness),
    (error) => error instanceof VpsUpdateError && error.exitCode === 7,
  );
  assert.deepEqual(harness.calls.slice(6, 10), [
    "switch:previous",
    "restart",
    "verify:previous",
    "transition:rolling-back",
  ]);
});

test("pure: plugin failure restores the previous release before reopening admission", async () => {
  const harness = activationHarness({
    pluginFailure: new Error("dir-skills failed"),
  });
  await assert.rejects(
    activateVpsRelease(activation, harness),
    (error) => error instanceof VpsUpdateError && error.exitCode === 7,
  );
  assert.deepEqual(harness.calls.slice(-6), [
    "plugins",
    "switch:previous",
    "restart",
    "verify:previous",
    "transition:rolling-back",
    "release:rolled-back",
  ]);
});

test("pure: plugin source restoration failure retains sealed maintenance", async () => {
  const harness = activationHarness({
    pluginFailure: new VpsUpdateError(
      "plugin sources could not be restored",
      8,
    ),
  });
  await assert.rejects(
    activateVpsRelease(activation, harness),
    (error) => error instanceof VpsUpdateError && error.exitCode === 8,
  );
  assert.equal(
    harness.calls.filter((call) => call.startsWith("release:")).length,
    0,
  );
  assert.equal(harness.calls.at(-1), "transition:rollback-failed");
});

const vpsCollection = "git:https://github.com/lettland/bb-plugins.git@master";
const vpsCollections = [{ source: vpsCollection }];

function collectionPlugins(...ids) {
  return ids.map((id) => ({ id, plugin: id, source: vpsCollection }));
}

function fakeVpsPluginCli(
  initial,
  {
    failInstall = null,
    failRemove = null,
    outdated: initialOutdated = [],
    failOutdated = false,
  } = {},
) {
  const pending = new Map(initialOutdated.map((entry) => [entry.id, entry]));
  const sources = new Map(
    Object.entries(initial).map(([id, requested]) => [
      id,
      requested === vpsCollection
        ? { requested, subdirectory: `plugins/${id}` }
        : { requested },
    ]),
  );
  let removeFailed = false;
  const calls = [];
  const execute = (_cli, args) => {
    calls.push(args.join(" "));
    const [group, action] = args;
    assert.equal(group, "plugin");
    const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
    if (action === "list") {
      return ok(
        JSON.stringify({
          plugins: [...sources].map(([id, source]) => ({
            id,
            source: source.requested,
          })),
        }),
      );
    }
    if (action === "source") {
      const source = sources.get(args[2]);
      return source === undefined
        ? { status: 1, stdout: "", stderr: "unknown plugin" }
        : ok(JSON.stringify(source));
    }
    if (action === "remove") {
      if (args[2] === failRemove && !removeFailed) {
        removeFailed = true;
        throw new Error(`remove ${args[2]} failed`);
      }
      sources.delete(args[2]);
      return ok();
    }
    if (action === "outdated") {
      if (failOutdated) throw new Error("bb plugin outdated --json exited 1");
      return ok(JSON.stringify([...pending.values()]));
    }
    if (action === "update") {
      pending.delete(args.at(-1));
      return ok();
    }
    if (action === "install") {
      const requested = args.at(-1);
      const pluginFlag = args.indexOf("--plugin");
      const subdirectoryFlag = args.indexOf("--subdirectory");
      const id =
        pluginFlag !== -1
          ? args[pluginFlag + 1]
          : subdirectoryFlag !== -1
            ? args[subdirectoryFlag + 1].split("/").at(-1)
            : requested.split("/").at(-1);
      if (id === failInstall && requested === vpsCollection) {
        throw new Error(`candidate ${id} failed`);
      }
      sources.set(
        id,
        pluginFlag !== -1
          ? { requested, subdirectory: `plugins/${id}` }
          : subdirectoryFlag !== -1
            ? { requested, subdirectory: args[subdirectoryFlag + 1] }
            : { requested },
      );
      return ok();
    }
    throw new Error(`unexpected command: ${args.join(" ")}`);
  };
  const requested = () =>
    Object.fromEntries(
      [...sources].map(([id, source]) => [id, source.requested]),
    );
  return { calls, execute, requested };
}

test("pure: partial VPS plugin synchronization restores every previous source", () => {
  const cli = fakeVpsPluginCli(
    {
      "shared-runtime": "path:/old/shared-runtime",
      "dir-skills": "path:/old/dir-skills",
    },
    { failInstall: "dir-skills" },
  );

  assert.throws(
    () =>
      syncVpsPlugins(
        {
          cli: "bb",
          plugins: collectionPlugins("shared-runtime", "dir-skills"),
          collections: vpsCollections,
        },
        cli.execute,
      ),
    /candidate dir-skills failed/u,
  );
  assert.deepEqual(cli.requested(), {
    "shared-runtime": "path:/old/shared-runtime",
    "dir-skills": "path:/old/dir-skills",
  });
  assert.ok(
    cli.calls.includes("plugin install --yes path:/old/shared-runtime"),
  );
  assert.ok(cli.calls.includes("plugin install --yes path:/old/dir-skills"));
});

test("pure: VPS plugin synchronization skips plugin update for a current collection plugin", (t) => {
  const log = t.mock.method(console, "log", () => {});
  const cli = fakeVpsPluginCli(
    { alpha: vpsCollection, beta: vpsCollection },
    {
      outdated: [
        { id: "alpha", outcome: "current" },
        { id: "beta", outcome: "update-available" },
      ],
    },
  );

  syncVpsPlugins(
    {
      cli: "bb",
      plugins: collectionPlugins("alpha", "beta"),
      collections: vpsCollections,
    },
    cli.execute,
  );
  assert.ok(!cli.calls.includes("plugin update --yes alpha"));
  assert.ok(cli.calls.includes("plugin update --yes beta"));
  assert.ok(
    log.mock.calls.some(
      (call) => call.arguments[0] === "Plugin alpha is up to date.",
    ),
  );
});

test("pure: VPS plugin synchronization updates every plugin when the outdated read fails", (t) => {
  const warnings = t.mock.method(console, "warn", () => {});
  const cli = fakeVpsPluginCli(
    { alpha: vpsCollection },
    { failOutdated: true },
  );

  syncVpsPlugins(
    {
      cli: "bb",
      plugins: collectionPlugins("alpha"),
      collections: vpsCollections,
    },
    cli.execute,
  );
  assert.ok(cli.calls.includes("plugin update --yes alpha"));
  assert.equal(warnings.mock.callCount(), 1);
  assert.match(
    warnings.mock.calls[0].arguments[0],
    /^Updating every collection plugin: bb plugin outdated --json exited 1/u,
  );
});

test("pure: VPS plugin synchronization re-points plugins from a moved collection", () => {
  const cli = fakeVpsPluginCli({
    "shared-runtime": "git:https://github.com/k0d3r1s/bb-plugins.git@master",
    "dir-skills": vpsCollection,
  });

  syncVpsPlugins(
    {
      cli: "bb",
      plugins: collectionPlugins("shared-runtime", "dir-skills"),
      collections: vpsCollections,
    },
    cli.execute,
  );
  assert.ok(cli.calls.includes("plugin remove shared-runtime"));
  assert.ok(
    cli.calls.includes(
      `plugin install --yes --plugin shared-runtime ${vpsCollection}`,
    ),
  );
  assert.ok(cli.calls.includes("plugin update --yes dir-skills"));
  assert.ok(!cli.calls.includes("plugin remove dir-skills"));
  assert.equal(cli.requested()["shared-runtime"], vpsCollection);
});

test("pure: VPS plugin synchronization installs every manifest plugin and prunes unlisted collection plugins", () => {
  const cli = fakeVpsPluginCli({
    "shared-runtime": vpsCollection,
    retired: vpsCollection,
    "local-tool": "path:/opt/local-tool",
  });

  syncVpsPlugins(
    {
      cli: "bb",
      plugins: collectionPlugins("shared-runtime", "auto-review", "devkit"),
      collections: vpsCollections,
    },
    cli.execute,
  );
  assert.deepEqual(cli.requested(), {
    "shared-runtime": vpsCollection,
    "auto-review": vpsCollection,
    devkit: vpsCollection,
    "local-tool": "path:/opt/local-tool",
  });
  assert.ok(cli.calls.includes("plugin remove retired"));
  assert.ok(!cli.calls.includes("plugin remove local-tool"));
});

test("pure: failed VPS plugin synchronization removes newly added plugins and reinstalls pruned ones", () => {
  const cli = fakeVpsPluginCli(
    {
      "shared-runtime": vpsCollection,
      retired: vpsCollection,
      stale: vpsCollection,
    },
    { failRemove: "stale" },
  );

  assert.throws(
    () =>
      syncVpsPlugins(
        {
          cli: "bb",
          plugins: collectionPlugins("shared-runtime", "devkit"),
          collections: vpsCollections,
        },
        cli.execute,
      ),
    /remove stale failed/u,
  );
  assert.deepEqual(cli.requested(), {
    "shared-runtime": vpsCollection,
    retired: vpsCollection,
    stale: vpsCollection,
  });
  assert.ok(cli.calls.includes("plugin remove devkit"));
  assert.ok(
    cli.calls.includes(
      `plugin install --yes --subdirectory plugins/retired ${vpsCollection}`,
    ),
  );
});

const pluginsOnlyPaths = {
  dataDir: "/srv/bb-data",
  currentPath: "/srv/share/current",
  releaseRoot: "/srv/share/releases",
};

function pluginsOnlyHarness(overrides = {}) {
  const calls = [];
  return {
    calls,
    dependencies: {
      readlinkImpl: async () => "/srv/share/releases/abc",
      validateRelease: async (root, target) => {
        calls.push(`validate ${root} ${target}`);
        return target;
      },
      maintenanceStatus: async (dataDir) => {
        calls.push(`status ${dataDir}`);
        return { lease: null };
      },
      resolvePlugins: async () => collectionPlugins("alpha"),
      isExecutable: async () => true,
      env: {},
      execute: () => {
        throw new Error("execute was not stubbed");
      },
      ...overrides,
    },
  };
}

test("pure: plugins-only reports a missing active release as unsupported", async () => {
  const harness = pluginsOnlyHarness({
    readlinkImpl: async () => {
      throw Object.assign(new Error("no such link"), { code: "ENOENT" });
    },
  });
  await assert.rejects(
    syncVpsPluginsOnly(pluginsOnlyPaths, harness.dependencies),
    (error) =>
      error instanceof VpsUpdateError &&
      error.exitCode === 3 &&
      error.message.includes("no active release at /srv/share/current"),
  );
  assert.deepEqual(harness.calls, []);
});

test("pure: plugins-only reports an unreachable maintenance socket as transport failure", async () => {
  const harness = pluginsOnlyHarness({
    maintenanceStatus: async () => {
      throw new Error("connect ENOENT");
    },
  });
  await assert.rejects(
    syncVpsPluginsOnly(pluginsOnlyPaths, harness.dependencies),
    (error) =>
      error instanceof VpsUpdateError &&
      error.exitCode === 6 &&
      error.message.includes("bb-local.service is not reachable") &&
      error.cause.message === "connect ENOENT",
  );
});

test("pure: plugins-only refuses to run while a maintenance lease is held", async () => {
  const executed = [];
  const harness = pluginsOnlyHarness({
    maintenanceStatus: async () => ({
      lease: { operationId: "op-7", phase: "sealed" },
    }),
    resolvePlugins: async () => {
      executed.push("resolve");
      return [];
    },
    execute: () => executed.push("execute"),
  });
  await assert.rejects(
    syncVpsPluginsOnly(pluginsOnlyPaths, harness.dependencies),
    (error) =>
      error instanceof VpsUpdateError &&
      error.exitCode === 4 &&
      error.message.includes("operation op-7 (sealed)"),
  );
  assert.deepEqual(executed, []);
});

test("pure: plugins-only wraps a plain sync failure as a release failure with the cause", async () => {
  const cli = fakeVpsPluginCli(
    { alpha: "path:/old/alpha" },
    { failInstall: "alpha" },
  );
  const harness = pluginsOnlyHarness({ execute: cli.execute });
  await assert.rejects(
    syncVpsPluginsOnly(pluginsOnlyPaths, harness.dependencies),
    (error) =>
      error instanceof VpsUpdateError &&
      error.exitCode === 9 &&
      error.message.includes(
        "plugin synchronization failed: candidate alpha failed",
      ),
  );
  assert.equal(cli.requested().alpha, "path:/old/alpha");
});

test("pure: plugins-only wraps a manifest fetch failure as a release failure", async () => {
  const harness = pluginsOnlyHarness({
    resolvePlugins: async () => {
      throw new Error("cannot fetch collection manifest");
    },
  });
  await assert.rejects(
    syncVpsPluginsOnly(pluginsOnlyPaths, harness.dependencies),
    (error) =>
      error.exitCode === 9 &&
      error.message ===
        "plugin synchronization failed: cannot fetch collection manifest",
  );
});

test("pure: plugins-only keeps the rollback-failed exit code with re-run guidance", async () => {
  const execute = (command, args) => {
    const action = args[1];
    if (action === "list") {
      return {
        status: 0,
        stdout: JSON.stringify({ plugins: [] }),
        stderr: "",
      };
    }
    if (action === "source") {
      return {
        status: 0,
        stdout: JSON.stringify({ requested: vpsCollection }),
        stderr: "",
      };
    }
    if (action === "update") throw new Error("update boom");
    if (action === "remove") throw new Error("remove boom");
    throw new Error(`unexpected command: ${args.join(" ")}`);
  };
  const harness = pluginsOnlyHarness({ execute });
  await assert.rejects(
    syncVpsPluginsOnly(pluginsOnlyPaths, harness.dependencies),
    (error) =>
      error instanceof VpsUpdateError &&
      error.exitCode === 8 &&
      error.message.includes("plugin synchronization failed (update boom)") &&
      error.message.includes(
        "restoring previous plugin sources also failed: remove boom;",
      ) &&
      error.message.includes(
        `no maintenance was held — inspect with BB_DATA_DIR="/srv/bb-data" "/srv/share/releases/abc/packages/bb-app/host-daemon/dist/bb" plugin list and rerun --plugins-only`,
      ),
  );
});

test("pure: plugins-only syncs through the validated release CLI with the data directory", async (t) => {
  t.mock.method(console, "log", () => {});
  const cli = fakeVpsPluginCli({ alpha: vpsCollection });
  const invocations = [];
  const harness = pluginsOnlyHarness({
    execute: (command, args, options) => {
      invocations.push({ command, env: options?.env });
      return cli.execute(command, args, options);
    },
  });
  await syncVpsPluginsOnly(pluginsOnlyPaths, harness.dependencies);
  assert.deepEqual(harness.calls, [
    "validate /srv/share/releases /srv/share/releases/abc",
    "status /srv/bb-data",
  ]);
  assert.ok(invocations.length > 0);
  for (const { command, env } of invocations) {
    assert.equal(
      command,
      "/srv/share/releases/abc/packages/bb-app/host-daemon/dist/bb",
    );
    assert.equal(env.BB_DATA_DIR, "/srv/bb-data");
  }
  assert.ok(cli.calls.includes("plugin update --yes alpha"));
});

test("pure: plugins-only updates other plugins after the collection sync with the data directory", async (t) => {
  t.mock.method(console, "log", () => {});
  const cli = fakeVpsPluginCli({ alpha: vpsCollection });
  const invocations = [];
  const received = [];
  const harness = pluginsOnlyHarness({
    execute: (command, args, options) => {
      invocations.push({
        args: args.join(" "),
        dataDir: options?.env?.BB_DATA_DIR,
      });
      return cli.execute(command, args, options);
    },
    updateOthers: async (skipIds, { command, ...rest }) => {
      received.push({ skipIds, ...rest });
      command(["plugin", "list", "--json"], { capture: true });
    },
  });
  await syncVpsPluginsOnly(pluginsOnlyPaths, harness.dependencies);
  assert.deepEqual(received, [{ skipIds: ["alpha"] }]);
  const last = invocations.at(-1);
  assert.equal(last.args, "plugin list --json");
  assert.equal(last.dataDir, "/srv/bb-data");
  assert.ok(
    invocations
      .slice(0, -1)
      .some((invocation) => invocation.args === "plugin update --yes alpha"),
  );
});

test("pure: plugins-only skips the other plugin pass with otherPlugins false", async (t) => {
  t.mock.method(console, "log", () => {});
  const cli = fakeVpsPluginCli({ alpha: vpsCollection });
  const calls = [];
  const harness = pluginsOnlyHarness({
    execute: cli.execute,
    updateOthers: async () => calls.push("others"),
  });
  await syncVpsPluginsOnly(
    { ...pluginsOnlyPaths, otherPlugins: false },
    harness.dependencies,
  );
  assert.deepEqual(calls, []);
  assert.ok(cli.calls.includes("plugin update --yes alpha"));
});

test("pure: plugins-only applies third-party updates through the real helper", async (t) => {
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  const cli = fakeVpsPluginCli(
    { alpha: vpsCollection, pets: "git:https://example.com/pets.git@main" },
    {
      outdated: [
        {
          id: "pets",
          outcome: "update-available",
          installed: { version: "1", display: "pets@1" },
          candidate: { version: "2", display: "pets@2" },
        },
      ],
    },
  );
  const environments = [];
  const harness = pluginsOnlyHarness({
    execute: (command, args, options) => {
      environments.push(options?.env?.BB_DATA_DIR);
      return cli.execute(command, args, options);
    },
  });
  await syncVpsPluginsOnly(pluginsOnlyPaths, harness.dependencies);
  assert.ok(cli.calls.includes("plugin update --yes pets"));
  assert.ok(
    cli.calls.indexOf("plugin update --yes pets") >
      cli.calls.indexOf("plugin update --yes alpha"),
  );
  assert.ok(environments.every((value) => value === "/srv/bb-data"));
});

test("pure: plugins-only still succeeds when the outdated read fails", async (t) => {
  t.mock.method(console, "log", () => {});
  const warnings = t.mock.method(console, "warn", () => {});
  const cli = fakeVpsPluginCli(
    { alpha: vpsCollection },
    { failOutdated: true },
  );
  const harness = pluginsOnlyHarness({ execute: cli.execute });
  await syncVpsPluginsOnly(pluginsOnlyPaths, harness.dependencies);
  assert.equal(warnings.mock.callCount(), 2);
  assert.match(
    warnings.mock.calls[0].arguments[0],
    /^Updating every collection plugin: bb plugin outdated --json exited 1/u,
  );
  assert.match(
    warnings.mock.calls[1].arguments[0],
    /^Skipping other plugin updates: bb plugin outdated --json exited 1/u,
  );
});

test("pure: plugins-only uses an injected BB_CLI and still sets the data directory", async (t) => {
  t.mock.method(console, "log", () => {});
  const cli = fakeVpsPluginCli({ alpha: vpsCollection });
  const invocations = [];
  const resolved = [];
  const harness = pluginsOnlyHarness({
    env: { BB_CLI: "/opt/custom/bb" },
    resolveCli: async (environment) => {
      resolved.push(environment.BB_CLI);
      return "/opt/custom/real-bb";
    },
    execute: (command, args, options) => {
      invocations.push({ command, env: options?.env });
      return cli.execute(command, args, options);
    },
  });
  await syncVpsPluginsOnly(pluginsOnlyPaths, harness.dependencies);
  assert.deepEqual(resolved, ["/opt/custom/bb"]);
  assert.ok(invocations.length > 0);
  for (const { command, env } of invocations) {
    assert.equal(command, "/opt/custom/real-bb");
    assert.equal(env.BB_DATA_DIR, "/srv/bb-data");
  }
});

test("pure: plugins-only rejects an invalid BB_CLI as a usage error before running anything", async () => {
  const executed = [];
  const harness = pluginsOnlyHarness({
    env: { BB_CLI: "relative/bb" },
    resolveCli: async () => {
      throw new Error("BB_CLI is not an absolute path: relative/bb");
    },
    execute: () => executed.push("execute"),
  });
  await assert.rejects(
    syncVpsPluginsOnly(pluginsOnlyPaths, harness.dependencies),
    (error) =>
      error instanceof VpsUpdateError &&
      error.exitCode === 2 &&
      error.message.includes("BB_CLI is not an absolute path"),
  );
  assert.deepEqual(executed, []);
});

test("pure: plugins-only rejects an invalid BB_CLI before probing a stopped service", async () => {
  const probed = [];
  const harness = pluginsOnlyHarness({
    env: { BB_CLI: "relative/bb" },
    resolveCli: async () => {
      throw new Error("BB_CLI is not an absolute path: relative/bb");
    },
    maintenanceStatus: async () => {
      probed.push("status");
      throw new Error("connect ENOENT");
    },
  });
  await assert.rejects(
    syncVpsPluginsOnly(pluginsOnlyPaths, harness.dependencies),
    (error) => error instanceof VpsUpdateError && error.exitCode === 2,
  );
  assert.deepEqual(probed, []);
});

test("pure: plugins-only exit-8 message falls back to the failure when no restore error is listed", async () => {
  const harness = pluginsOnlyHarness({
    execute: () => {
      throw new VpsUpdateError(
        "restore bookkeeping failed",
        VPS_UPDATE_EXIT_CODES.rollbackFailed,
        new Error("lone failure"),
      );
    },
  });
  await assert.rejects(
    syncVpsPluginsOnly(pluginsOnlyPaths, harness.dependencies),
    (error) =>
      error.exitCode === 8 &&
      error.message.includes(
        "plugin synchronization failed (lone failure) and restoring previous plugin sources also failed: restore bookkeeping failed;",
      ),
  );
});

test("pure: resolves an explicit VPS CLI only when BB_CLI is set", async () => {
  const resolved = [];
  const resolveCli = async (environment) => {
    resolved.push(environment.BB_CLI);
    if (environment.BB_CLI === "bad") throw new Error("BB_CLI is invalid");
    return `/real${environment.BB_CLI}`;
  };
  assert.equal(await resolveExplicitVpsCli({}, resolveCli), null);
  assert.equal(await resolveExplicitVpsCli({ BB_CLI: "  " }, resolveCli), null);
  assert.deepEqual(resolved, []);
  assert.equal(
    await resolveExplicitVpsCli({ BB_CLI: "/opt/bb" }, resolveCli),
    "/real/opt/bb",
  );
  await assert.rejects(
    resolveExplicitVpsCli({ BB_CLI: "bad" }, resolveCli),
    /BB_CLI is invalid/u,
  );
});

test("pure: plugins-only reports an invalid active release with recovery guidance", async () => {
  const harness = pluginsOnlyHarness({
    validateRelease: async () => {
      throw new Error("release is not owned");
    },
  });
  await assert.rejects(
    syncVpsPluginsOnly(pluginsOnlyPaths, harness.dependencies),
    (error) =>
      error instanceof VpsUpdateError &&
      error.exitCode === 3 &&
      error.message ===
        "active release at /srv/share/current is not a valid owned release: release is not owned; run a full pnpm vps:local:update (or --bootstrap)" &&
      error.cause.message === "release is not owned",
  );
});

test("pure: plugins-only reports an unreadable active release link as unsupported", async () => {
  const harness = pluginsOnlyHarness({
    readlinkImpl: async () => {
      throw Object.assign(new Error("not a symlink"), { code: "EINVAL" });
    },
  });
  await assert.rejects(
    syncVpsPluginsOnly(pluginsOnlyPaths, harness.dependencies),
    (error) =>
      error instanceof VpsUpdateError &&
      error.exitCode === 3 &&
      error.message.includes("not a valid owned release: not a symlink"),
  );
});

test("pure: plugins-only reports a missing release CLI as unsupported before running anything", async () => {
  const executed = [];
  const harness = pluginsOnlyHarness({
    isExecutable: async () => false,
    execute: () => executed.push("execute"),
  });
  await assert.rejects(
    syncVpsPluginsOnly(pluginsOnlyPaths, harness.dependencies),
    (error) =>
      error instanceof VpsUpdateError &&
      error.exitCode === 3 &&
      error.message ===
        "bb CLI not found or not executable at /srv/share/releases/abc/packages/bb-app/host-daemon/dist/bb; run a full pnpm vps:local:update",
  );
  assert.deepEqual(executed, []);
});

test("pure: the flock contention status cannot collide with an updater exit code", () => {
  assert.ok(
    !Object.values(VPS_UPDATE_EXIT_CODES).includes(FLOCK_CONTENTION_STATUS),
  );
});

test("pure: rollback failure retains fail-closed maintenance", async () => {
  const harness = activationHarness({
    verifyFailure: new Error("candidate dead"),
    rollbackFailure: new Error("previous dead"),
  });
  await assert.rejects(
    activateVpsRelease(activation, harness),
    (error) => error instanceof VpsUpdateError && error.exitCode === 8,
  );
  assert.equal(
    harness.calls.filter((call) => call.startsWith("release:")).length,
    0,
  );
  assert.equal(harness.calls.at(-1), "transition:rollback-failed");
});

test("pure: release failure retains the healthy candidate without attempting rollback", async () => {
  const harness = activationHarness({
    releaseFailure: new Error("daemon unavailable"),
  });
  await assert.rejects(
    activateVpsRelease(activation, harness),
    (error) => error instanceof VpsUpdateError && error.exitCode === 9,
  );
  assert.deepEqual(harness.calls.slice(-3), [
    "verify:candidate",
    "plugins",
    "release:completed",
  ]);
  assert.equal(
    harness.calls.filter((call) => call === "switch:previous").length,
    0,
  );
});

test("pure: recovery restores and resolves every durable post-seal phase", async () => {
  for (const phase of [
    "sealed",
    "activating",
    "verifying",
    "plugins",
    "rolling-back",
    "rollback-failed",
    "releasing",
    "plugin-failed",
  ]) {
    const calls = [];
    const admin = {
      async status() {
        calls.push("status");
        return { lease: { operationId: "op-1", phase } };
      },
      async transition(input) {
        calls.push(`transition:${input.expectedPhase}->${input.phase}`);
      },
      async release(input) {
        calls.push(`release:${input.resolution}`);
      },
    };
    await recoverVpsRelease(
      {
        operationId: "op-1",
        ownerSecret: "secret",
        record: { phase, previousRelease: "previous" },
      },
      {
        admin,
        runtime: {
          async restorePrevious(target) {
            calls.push(`restore:${target}`);
          },
        },
      },
    );
    assert.equal(calls[0], "restore:previous");
    assert.equal(calls.at(-1), "release:rolled-back");
    if (phase === "rolling-back" || phase === "releasing") {
      assert.equal(
        calls.some((call) => call.startsWith("transition:")),
        false,
      );
    } else {
      assert.ok(calls.includes(`transition:${phase}->rolling-back`));
    }
  }
});

test("pure: legacy bootstrap recovery restores without using the admin protocol", async () => {
  const calls = [];
  await recoverVpsRelease(
    {
      operationId: "op-bootstrap",
      ownerSecret: null,
      record: { phase: "candidate-failed", previousRelease: "previous" },
    },
    {
      admin: new Proxy(
        {},
        {
          get() {
            throw new Error("legacy recovery must not use the admin protocol");
          },
        },
      ),
      runtime: {
        async restorePrevious(target) {
          calls.push(`restore:${target}`);
        },
      },
    },
  );
  assert.deepEqual(calls, ["restore:previous"]);
});

test("pure: first bootstrap failure restores the inactive no-current state", async () => {
  const calls = [];
  await assert.rejects(
    activateBootstrapRelease(
      { candidateRelease: "candidate", previousRelease: "none" },
      {
        runtime: {
          async reportPhase(phase) {
            calls.push(`phase:${phase}`);
          },
          async switchCurrent(target) {
            calls.push(`switch:${target}`);
          },
          async start() {
            calls.push("start");
            throw new Error("start failed");
          },
          async verify() {
            calls.push("verify");
          },
          async restorePrevious(target) {
            calls.push(`restore:${target}`);
          },
          async restoreInactive() {
            calls.push("restore:inactive");
          },
          async reportFailure() {
            calls.push("phase:candidate-failed");
          },
        },
      },
    ),
    (error) => error instanceof VpsUpdateError && error.exitCode === 7,
  );
  assert.deepEqual(calls, [
    "phase:activating",
    "switch:candidate",
    "start",
    "restore:inactive",
    "phase:candidate-failed",
  ]);
});

test("pure: bootstrap rollback failure remains recoverable and is recorded", async () => {
  const calls = [];
  await assert.rejects(
    activateBootstrapRelease(
      { candidateRelease: "candidate", previousRelease: "previous" },
      {
        runtime: {
          async reportPhase(phase) {
            calls.push(`phase:${phase}`);
          },
          async switchCurrent(target) {
            calls.push(`switch:${target}`);
          },
          async start() {
            calls.push("start");
          },
          async verify() {
            calls.push("verify");
            throw new Error("candidate failed");
          },
          async restorePrevious(target) {
            calls.push(`restore:${target}`);
            throw new Error("rollback failed");
          },
          async restoreInactive() {
            calls.push("restore:inactive");
          },
          async reportFailure(error) {
            calls.push(`phase:candidate-failed:${error.message}`);
          },
        },
      },
    ),
    (error) => error instanceof VpsUpdateError && error.exitCode === 8,
  );
  assert.deepEqual(calls, [
    "phase:activating",
    "switch:candidate",
    "start",
    "phase:verifying",
    "verify",
    "restore:previous",
    "phase:candidate-failed:rollback failed",
  ]);
});
