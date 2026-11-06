import { constants as fsConstants, existsSync } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const upstreamBranch = process.env.BB_LOCAL_UPSTREAM_BRANCH ?? "main";
const forkBranch = process.env.BB_LOCAL_FORK_BRANCH ?? "main";
const upstreamSlug = (
  process.env.BB_LOCAL_UPSTREAM_SLUG ?? "get-bb/bb"
).toLowerCase();
const packagedApp = path.join(
  repoRoot,
  "apps",
  "desktop",
  "release",
  "mac-arm64",
  "bb Local.app",
);
const installedApp = "/Applications/bb Local.app";
const officialApp = "/Applications/bb.app";
const localBundleId = "dev.bb.desktop.local";
export const installedBbLocalCli = path.join(
  installedApp,
  "Contents",
  "Resources",
  "app.asar.unpacked",
  "node_modules",
  "bb-app",
  "host-daemon",
  "dist",
  "bb",
);
const officialProcessPattern = "^/Applications/bb\\.app/Contents/MacOS/bb( |$)";
const localProcessPattern =
  "^/Applications/bb Local\\.app/Contents/MacOS/bb( |$)";
export const localMainProcessPattern =
  "^/Applications/bb Local\\.app/Contents/MacOS/bb Local$";
const localDaemonProcessPattern =
  "^/Applications/bb Local\\.app/Contents/MacOS/bb Local /Applications/bb Local\\.app/Contents/Resources/app\\.asar\\.unpacked/node_modules/bb-app/host-daemon/dist/daemon-bundle\\.mjs";
export const externalPluginCollections = [
  { source: "git:https://github.com/lettland/bb-plugins.git@master" },
];
const npmScriptPolicyEnvironmentKeys = new Set([
  "npm_config_allow_scripts",
  "npm_config_ignore_scripts",
  "npm_config_foreground_scripts",
]);

export function parseLocalUpdateArgs(argv) {
  const options = {
    check: false,
    current: false,
    install: true,
    otherPlugins: true,
    plugins: true,
    pluginsOnly: false,
    push: true,
    recover: false,
  };
  const flags = [];
  for (const argument of argv) {
    if (argument === "--") continue;
    flags.push(argument);
    if (argument === "--check") options.check = true;
    else if (argument === "--recover") options.recover = true;
    else if (argument === "--current") options.current = true;
    else if (argument === "--skip-install") options.install = false;
    else if (argument === "--skip-plugins") options.plugins = false;
    else if (argument === "--skip-other-plugins") options.otherPlugins = false;
    else if (argument === "--skip-push") options.push = false;
    else if (argument === "--plugins-only") options.pluginsOnly = true;
    else {
      throw new Error(
        `unknown argument: ${argument}; valid flags: --check, --current, --recover, --skip-install, --skip-plugins, --skip-other-plugins, --skip-push, --plugins-only`,
      );
    }
  }
  if (options.pluginsOnly) {
    const other = flags.find(
      (flag) => flag !== "--plugins-only" && flag !== "--skip-other-plugins",
    );
    if (other !== undefined) {
      throw new Error(`--plugins-only cannot be combined with \`${other}\``);
    }
  }
  return options;
}

export function externalPluginSyncAction(requested, desired = null) {
  if (requested === null) return "install";
  if (!requested.startsWith("git:")) return "reinstall";
  const requestedRepository = collectionRepositoryKey(requested);
  const desiredRepository =
    desired === null ? null : collectionRepositoryKey(desired);
  if (requestedRepository === null || desiredRepository === null) {
    return "update";
  }
  return requestedRepository === desiredRepository ? "update" : "reinstall";
}

function parseGithubGitSource(source) {
  const match =
    /^git:https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?@([^@]+)$/u.exec(
      source,
    );
  if (match === null) return null;
  const [, owner, repository, ref] = match;
  return { owner, repository, ref };
}

export function collectionManifestUrl(source) {
  const parsed = parseGithubGitSource(source);
  if (parsed === null) {
    throw new Error(
      `cannot derive a collection manifest URL from "${source}"; expected git:https://github.com/<owner>/<repo>@<ref>`,
    );
  }
  return `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repository}/${parsed.ref}/.bb/plugins.json`;
}

export function collectionSourceKey(source) {
  const parsed = parseGithubGitSource(source);
  return parsed === null
    ? null
    : `${parsed.owner}/${parsed.repository}@${parsed.ref}`;
}

export function collectionRepositoryKey(source) {
  const parsed = parseGithubGitSource(source);
  return parsed === null ? null : `${parsed.owner}/${parsed.repository}`;
}

export function unlistedCollectionPluginIds(installed, collections, desired) {
  const collectionKeys = new Set(
    collections
      .map((collection) => collectionSourceKey(collection.source))
      .filter((key) => key !== null),
  );
  const desiredByKey = new Set();
  for (const plugin of desired) {
    if (typeof plugin.id !== "string" || plugin.id === "") {
      throw new Error("desired plugin entry is missing a string id");
    }
    desiredByKey.add(`${collectionSourceKey(plugin.source)}\u0000${plugin.id}`);
  }
  return installed
    .filter((plugin) => {
      const key = collectionSourceKey(plugin.source);
      return (
        key !== null &&
        collectionKeys.has(key) &&
        !desiredByKey.has(`${key}\u0000${plugin.id}`)
      );
    })
    .map((plugin) => plugin.id);
}

const collectionEntryNamePattern = /^[a-z0-9][a-z0-9-]*$/u;

export function collectionEntryNames(
  manifest,
  location = "collection manifest",
) {
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.plugins) ||
    manifest.plugins.length === 0
  ) {
    throw new Error(`${location} is not a valid .bb/plugins.json document`);
  }
  const names = [];
  const seen = new Set();
  manifest.plugins.forEach((entry, index) => {
    const name =
      typeof entry === "object" && entry !== null ? entry.name : undefined;
    if (typeof name !== "string" || !collectionEntryNamePattern.test(name)) {
      throw new Error(
        `${location} entry ${index} has an invalid plugin name ${JSON.stringify(name)}`,
      );
    }
    if (seen.has(name)) {
      throw new Error(`${location} lists plugin "${name}" more than once`);
    }
    seen.add(name);
    names.push(name);
  });
  return names;
}

export async function resolveExternalPlugins(collections, fetchImpl = fetch) {
  const plugins = [];
  for (const collection of collections) {
    const url = collectionManifestUrl(collection.source);
    let response;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      throw new Error(
        `cannot fetch collection manifest at ${url}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new Error(
        `cannot read collection manifest at ${url}: HTTP ${response.status}`,
      );
    }
    let manifest;
    try {
      manifest = await response.json();
    } catch (error) {
      throw new Error(
        `collection manifest at ${url} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    for (const name of collectionEntryNames(
      manifest,
      `collection manifest at ${url}`,
    )) {
      plugins.push({ id: name, plugin: name, source: collection.source });
    }
  }
  return plugins;
}

export function remoteSlug(url) {
  const trimmed = url.trim().replace(/\.git$/u, "");
  const scp = /^[^/]+@[^:]+:(.+)$/u.exec(trimmed);
  const withoutOrigin = scp
    ? scp[1]
    : trimmed.replace(/^[a-z+]+:\/\/[^/]*\//iu, "");
  return withoutOrigin
    .split("/")
    .filter((segment) => segment !== "")
    .slice(-2)
    .join("/")
    .toLowerCase();
}

export function resolveRemoteNames(remotes, overrides = {}) {
  const isUpstream = (remote) => remoteSlug(remote.url) === upstreamSlug;
  const pushesToUpstream = (remote) =>
    (remote.pushUrls ?? [remote.url]).some(
      (url) => remoteSlug(url) === upstreamSlug,
    );
  const upstream = overrides.upstream ?? remotes.find(isUpstream)?.name;
  if (upstream === undefined) {
    throw new Error(
      `no remote matches ${upstreamSlug}; set BB_LOCAL_UPSTREAM_REMOTE or BB_LOCAL_UPSTREAM_SLUG`,
    );
  }
  const candidates = remotes.filter(
    (remote) => remote.name !== upstream && !isUpstream(remote),
  );
  const named = (name) =>
    candidates.find((remote) => remote.name === name)?.name;
  const fork =
    overrides.fork ?? named("fork") ?? named("origin") ?? candidates[0]?.name;
  if (fork === undefined) {
    throw new Error("no fork remote found; set BB_LOCAL_FORK_REMOTE");
  }
  if (
    remotes.some((remote) => remote.name === fork && pushesToUpstream(remote))
  ) {
    throw new Error(
      `fork remote ${fork} points at ${upstreamSlug}; refusing to force-push to upstream`,
    );
  }
  if (fork === upstream) {
    throw new Error(
      `fork and upstream both resolve to ${fork}; set BB_LOCAL_FORK_REMOTE to a different remote`,
    );
  }
  return { fork, upstream };
}

export function resolveForkRemote(remotes, override) {
  const isUpstream = (remote) => remoteSlug(remote.url) === upstreamSlug;
  const pushesToUpstream = (remote) =>
    (remote.pushUrls ?? [remote.url]).some(
      (url) => remoteSlug(url) === upstreamSlug,
    );
  if (override !== undefined) {
    const configured = remotes.find((remote) => remote.name === override);
    if (configured === undefined) {
      throw new Error(`fork remote ${override} is not configured`);
    }
    if (pushesToUpstream(configured)) {
      throw new Error(
        `fork remote ${override} points at ${upstreamSlug}; refusing to force-push to upstream`,
      );
    }
    return configured.name;
  }
  const candidates = remotes.filter((remote) => !isUpstream(remote));
  const fork =
    candidates.find((remote) => remote.name === "fork")?.name ??
    candidates.find((remote) => remote.name === "origin")?.name ??
    candidates[0]?.name;
  if (fork === undefined) {
    throw new Error("no fork remote found; set BB_LOCAL_FORK_REMOTE");
  }
  const configured = candidates.find((remote) => remote.name === fork);
  if (configured !== undefined && pushesToUpstream(configured)) {
    throw new Error(
      `fork remote ${fork} points at ${upstreamSlug}; refusing to force-push to upstream`,
    );
  }
  return fork;
}

export function pushArguments(remoteHead, remote, branch = forkBranch) {
  const args = ["push"];
  if (remoteHead !== null) {
    args.push(`--force-with-lease=refs/heads/${branch}:${remoteHead}`);
  }
  args.push(remote, `HEAD:${branch}`);
  return args;
}

export function backupAppPath(now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/gu, "-");
  return path.join(os.homedir(), ".Trash", `bb-local-backup-${stamp}.app`);
}

export function npmEnvironment(environment) {
  const result = { ...environment };
  for (const key of Object.keys(result)) {
    if (npmScriptPolicyEnvironmentKeys.has(key.toLowerCase())) {
      delete result[key];
    }
  }
  return result;
}

async function executableRealPath(candidate) {
  try {
    await access(candidate, fsConstants.X_OK);
    if (!(await stat(candidate)).isFile()) return null;
    return realpath(candidate);
  } catch {
    return null;
  }
}

export async function resolveBbCli(
  environment = process.env,
  { applicationsRoot = "/Applications" } = {},
) {
  const explicit = environment.BB_CLI?.trim();
  if (explicit !== undefined && explicit !== "") {
    if (!path.isAbsolute(explicit)) {
      throw new Error(`BB_CLI is not an absolute path: ${explicit}`);
    }
    const resolved = await executableRealPath(explicit);
    if (resolved === null) {
      throw new Error(`BB_CLI is not an existing executable: ${explicit}`);
    }
    return resolved;
  }
  const candidates = [
    ...(environment.PATH ?? "")
      .split(path.delimiter)
      .filter((directory) => directory !== "")
      .map((directory) => path.join(directory, "bb")),
    path.join(
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
    ),
    path.join(
      applicationsRoot,
      "BB.app",
      "Contents",
      "Resources",
      "app.asar.unpacked",
      "node_modules",
      "bb-app",
      "host-daemon",
      "dist",
      "bb",
    ),
    path.join(
      applicationsRoot,
      "bb Local.app",
      "Contents",
      "Resources",
      "app.asar.unpacked",
      "node_modules",
      "bb-app",
      "host-daemon",
      "dist",
      "bb",
    ),
    path.join(
      packagedApp,
      "Contents",
      "Resources",
      "app.asar.unpacked",
      "node_modules",
      "bb-app",
      "host-daemon",
      "dist",
      "bb",
    ),
    "/opt/homebrew/bin/bb",
    "/usr/local/bin/bb",
  ];
  for (const candidate of candidates) {
    const resolved = await executableRealPath(candidate);
    if (resolved !== null) return resolved;
  }
  throw new Error(
    "cannot resolve the BB CLI; set BB_CLI to its absolute executable path",
  );
}

const defaultInterruptNotice =
  "stopping and releasing the update pause (send it again to exit immediately)";

const interruption = {
  signal: null,
  checking: true,
  recoveryText: "",
  notice: defaultInterruptNotice,
};

export function requestInterrupt(signal) {
  if (interruption.signal === null) interruption.signal = signal;
}

export function throwIfInterrupted() {
  if (interruption.checking && interruption.signal !== null) {
    throw new Error(`interrupted by ${interruption.signal}`);
  }
}

export function beginCleanup() {
  interruption.checking = false;
}

export function interruptRequested() {
  return interruption.signal !== null;
}

export function resetInterruption() {
  interruption.signal = null;
  interruption.checking = true;
  interruption.recoveryText = "";
  interruption.notice = defaultInterruptNotice;
}

export function beginPostReleaseInterrupts() {
  interruption.recoveryText = "";
  interruption.notice =
    "the bb update is already applied; stopping (send it again to exit immediately)";
}

export function setInterruptRecoveryText(text) {
  interruption.recoveryText = text;
}

export async function checkpoint() {
  await new Promise(setImmediate);
  throwIfInterrupted();
}

export function installSignalHandlers() {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      if (interruption.signal !== null) {
        console.error(
          `Received ${signal} again; exiting now.\n${interruption.recoveryText}`,
        );
        process.exit(130);
      }
      requestInterrupt(signal);
      console.error(`Received ${signal}; ${interruption.notice}`);
    });
  }
}

export function run(command, args, options = {}) {
  const capture = options.capture === true;
  const environment = { ...process.env, ...options.env };
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: command === "npm" ? npmEnvironment(environment) : environment,
    stdio: capture ? "pipe" : "inherit",
    timeout: options.timeoutMs,
  });
  if (result.error !== undefined) throw result.error;
  throwIfInterrupted();
  const status = result.status ?? 1;
  if (status !== 0 && options.allowFailure !== true) {
    const detail = [result.stdout, result.stderr]
      .filter((value) => typeof value === "string" && value.trim() !== "")
      .join("\n")
      .trim();
    throw new Error(
      `${command} ${args.join(" ")} exited ${status}${detail === "" ? "" : `\n${detail}`}`,
    );
  }
  return {
    status,
    stdout:
      typeof result.stdout !== "string"
        ? ""
        : options.trim === "end"
          ? result.stdout.trimEnd()
          : result.stdout.trim(),
    stderr: typeof result.stderr === "string" ? result.stderr.trim() : "",
  };
}

function matchingProcessIds(pattern) {
  const result = run("/usr/bin/pgrep", ["-f", pattern], {
    allowFailure: true,
    capture: true,
  });
  if (result.status === 1) return [];
  if (result.status !== 0) {
    throw new Error(`cannot inspect application processes\n${result.stderr}`);
  }
  return result.stdout.split("\n").filter((value) => value !== "");
}

export async function waitForProcessExit(pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    throwIfInterrupted();
    if (matchingProcessIds(pattern).length === 0) return true;
    await delay(100);
  }
  return false;
}

export async function waitForLocalServerHealth(
  label,
  processPattern,
  timeoutMs = 300_000,
) {
  const port = process.env.BB_SERVER_PORT ?? "38886";
  const url = `http://127.0.0.1:${port}/health`;
  const deadline = Date.now() + timeoutMs;
  let processObserved = false;
  let processChecks = 0;
  let nextProgressAt = Date.now() + 10_000;
  while (true) {
    throwIfInterrupted();
    const processIds = matchingProcessIds(processPattern);
    if (processIds.length > 0) processObserved = true;
    if (processObserved && processIds.length === 0) {
      throw new Error(`${label} exited before becoming healthy at ${url}`);
    }
    processChecks += 1;
    if (!processObserved && processChecks >= 100) {
      throw new Error(`${label} did not launch`);
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `${label} did not become healthy at ${url} within ${Math.round(timeoutMs / 1000)} seconds`,
      );
    }
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        const health = await response.json();
        if (
          typeof health === "object" &&
          health !== null &&
          health.ok === true
        ) {
          return;
        }
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
    if (Date.now() >= nextProgressAt) {
      console.log(
        `Waiting for ${label} to become healthy; complete any macOS keychain prompt`,
      );
      nextProgressAt = Date.now() + 10_000;
    }
    await delay(100);
  }
}

async function startOfficialApp() {
  if (matchingProcessIds(officialProcessPattern).length === 0) {
    run("/usr/bin/open", ["-na", officialApp]);
  }
  await waitForLocalServerHealth("official BB app", officialProcessPattern);
}

async function stopOfficialApp() {
  if (matchingProcessIds(officialProcessPattern).length === 0) return;
  run(
    "/usr/bin/osascript",
    ["-e", 'tell application id "dev.bb.desktop" to quit'],
    { allowFailure: true, capture: true },
  );
  if (await waitForProcessExit(officialProcessPattern, 10_000)) return;
  run("/usr/bin/pkill", ["-TERM", "-f", officialProcessPattern], {
    allowFailure: true,
  });
  if (!(await waitForProcessExit(officialProcessPattern, 5_000))) {
    throw new Error("official BB app did not stop");
  }
}

async function ensureOfficialStopped(reason) {
  if (matchingProcessIds(officialProcessPattern).length === 0) return;
  console.warn(`Official bb.app is running; stopping it (${reason})`);
  await stopOfficialApp();
}

async function startLocalApp() {
  run("/usr/bin/open", ["-na", installedApp]);
  await waitForLocalServerHealth("bb Local app", localMainProcessPattern);
}

async function ensureLocalAppRunning() {
  if (matchingProcessIds(localMainProcessPattern).length === 0) {
    await startLocalApp();
    return;
  }
  await waitForLocalServerHealth("bb Local app", localMainProcessPattern);
}

async function terminateProcesses(pattern, label) {
  if (await waitForProcessExit(pattern, 10_000)) return;
  run("/usr/bin/pkill", ["-TERM", "-f", pattern], { allowFailure: true });
  if (!(await waitForProcessExit(pattern, 5_000))) {
    throw new Error(`${label} did not stop`);
  }
}

async function stopLocalApp() {
  if (matchingProcessIds(localMainProcessPattern).length > 0) {
    run(
      "/usr/bin/osascript",
      ["-e", `tell application id "${localBundleId}" to quit`],
      { allowFailure: true, capture: true },
    );
  }
  await terminateProcesses(localProcessPattern, "bb Local");
  await terminateProcesses(localDaemonProcessPattern, "bb Local host daemon");
}

async function restoreBackupApp(backup) {
  await access(backup);
  let aside = null;
  if (await pathExists(installedApp)) {
    const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
    aside = path.join(os.homedir(), ".Trash", `bb-local-failed-${stamp}.app`);
    await mkdir(path.dirname(aside), { recursive: true });
    await rename(installedApp, aside);
  }
  try {
    await rename(backup, installedApp);
  } catch (error) {
    if (aside !== null) await rename(aside, installedApp);
    throw error;
  }
}

export function gitOutput(args, options = {}) {
  return run("git", args, { ...options, capture: true });
}

function requireCleanWorktree({ allowDirty = false } = {}) {
  const root = gitOutput(["rev-parse", "--show-toplevel"]).stdout;
  if (path.resolve(root) !== repoRoot) {
    throw new Error(`run this command from the bb fork at ${repoRoot}`);
  }
  const branch = gitOutput(["branch", "--show-current"]).stdout;
  if (branch === "") throw new Error("the local fork branch is detached");
  const status = gitOutput(
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { trim: "end" },
  ).stdout;
  if (status !== "" && !allowDirty)
    throw new Error(`the local fork worktree is not clean\n${status}`);
  return { branch, status };
}

function remoteHead(forkRemote) {
  const result = gitOutput(
    ["rev-parse", "--verify", `refs/remotes/${forkRemote}/${forkBranch}`],
    { allowFailure: true },
  );
  return result.status === 0 ? result.stdout : null;
}

function configuredRemotes() {
  const seen = new Map();
  for (const line of gitOutput(["remote", "-v"]).stdout.split("\n")) {
    const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/u.exec(line.trim());
    if (match !== null && !seen.has(match[1])) seen.set(match[1], match[2]);
  }
  return [...seen].map(([name, url]) => ({
    name,
    pushUrls: gitOutput(["remote", "get-url", "--push", "--all", name])
      .stdout.split("\n")
      .filter((pushUrl) => pushUrl !== ""),
    url,
  }));
}

function activeRemotes() {
  const overrides = {};
  const upstream = process.env.BB_LOCAL_UPSTREAM_REMOTE;
  const fork = process.env.BB_LOCAL_FORK_REMOTE;
  if (upstream !== undefined) overrides.upstream = upstream;
  if (fork !== undefined) overrides.fork = fork;
  return resolveRemoteNames(configuredRemotes(), overrides);
}

function activeForkRemote() {
  return resolveForkRemote(
    configuredRemotes(),
    process.env.BB_LOCAL_FORK_REMOTE,
  );
}

function countCommits(range) {
  return Number.parseInt(gitOutput(["rev-list", "--count", range]).stdout, 10);
}

function readPluginSource(cli, id) {
  const result = run(cli, ["plugin", "source", id, "--json"], {
    env: { BB_CLI: cli },
    allowFailure: true,
    capture: true,
  });
  if (result.status === 0) {
    const parsed = JSON.parse(result.stdout);
    return typeof parsed.requested === "string" ? parsed.requested : null;
  }
  if (`${result.stdout}\n${result.stderr}`.includes("unknown plugin"))
    return null;
  throw new Error(
    `cannot inspect plugin ${id}\n${result.stderr || result.stdout}`,
  );
}

export async function ensurePluginServerAvailable({
  readSource,
  startOfficial = startOfficialApp,
}) {
  try {
    readSource("shared-runtime");
    return;
  } catch {
    await startOfficial();
  }
  try {
    readSource("shared-runtime");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `cannot connect to the official BB server after starting it\n${detail}`,
      { cause: error },
    );
  }
}

export function syncCollectionPlugin(
  plugin,
  requested,
  { command, readSource, outcome = null, log = console.log },
) {
  const action = externalPluginSyncAction(requested, plugin.source);
  if (action === "update") {
    if (outcome === "current") {
      log(`Plugin ${plugin.id} is up to date.`);
      return;
    }
    command(["plugin", "update", "--yes", plugin.id]);
    return;
  }
  if (action === "reinstall") {
    command(["plugin", "remove", plugin.id]);
  }
  command([
    "plugin",
    "install",
    "--yes",
    "--plugin",
    plugin.plugin,
    plugin.source,
  ]);
  if (readSource(plugin.id) === null) {
    throw new Error(
      `installed collection plugin "${plugin.plugin}" is not registered as id "${plugin.id}"; its .bb/plugins.json entry name must match the plugin's derived id`,
    );
  }
}

function syncExternalPlugin(cli, plugin, outcomes) {
  const readSource = (id) => readPluginSource(cli, id);
  syncCollectionPlugin(plugin, readSource(plugin.id), {
    command: (args) => run(cli, args, { env: { BB_CLI: cli } }),
    readSource,
    outcome: outcomes.get(plugin.id) ?? null,
  });
}

export function parseInstalledPlugins(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `cannot parse \`bb plugin list --json\` output: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return Array.isArray(parsed.plugins) ? parsed.plugins : [];
}

function readInstalledPlugins(cli) {
  return parseInstalledPlugins(
    run(cli, ["plugin", "list", "--json"], {
      env: { BB_CLI: cli },
      capture: true,
    }).stdout,
  );
}

async function removeUnlistedCollectionPlugins(cli, collections, desired) {
  const ids = unlistedCollectionPluginIds(
    readInstalledPlugins(cli),
    collections,
    desired,
  );
  if (ids.length === 0) return;
  console.log(
    `Removing ${ids.length} external plugin(s) no longer in the collection manifest; their settings, secrets, and schedules are dropped: ${ids.join(", ")}`,
  );
  for (const id of ids) {
    run(cli, ["plugin", "remove", id], { env: { BB_CLI: cli } });
    await checkpoint();
  }
}

async function installPackagedApp(backup = backupAppPath()) {
  let hadInstalledApp = false;
  try {
    await access(installedApp);
    hadInstalledApp = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(path.dirname(backup), { recursive: true });
  if (hadInstalledApp) await rename(installedApp, backup);
  try {
    run("ditto", [packagedApp, installedApp]);
    run("codesign", ["--verify", "--deep", "--strict", installedApp]);
    const identifier = run(
      "/usr/libexec/PlistBuddy",
      [
        "-c",
        "Print :CFBundleIdentifier",
        path.join(installedApp, "Contents", "Info.plist"),
      ],
      { capture: true },
    ).stdout;
    if (identifier !== "dev.bb.desktop.local") {
      throw new Error(
        `installed app has unexpected bundle identifier ${identifier}`,
      );
    }
  } catch (error) {
    await rm(installedApp, { recursive: true, force: true });
    if (hadInstalledApp) await rename(backup, installedApp);
    throw error;
  }
  if (hadInstalledApp) console.log(`Previous local app moved to ${backup}`);
}

export async function installAndActivateLocalApp({
  install = installPackagedApp,
  startLocal = startLocalApp,
  stopOfficial = stopOfficialApp,
} = {}) {
  await install();
  await stopOfficial();
  await startLocal();
}

export function assertNotInsideBb(environment = process.env) {
  if (environment.BB_THREAD_ID || environment.BB_TERMINAL_SESSION_ID) {
    throw new Error(
      "run the local desktop updater from Terminal or iTerm, not from inside bb Local: it quits bb Local, which would kill the updater while work is paused",
    );
  }
}

export function resolveDataDir(
  environment = process.env,
  homeDirectory = os.homedir(),
) {
  const configured = environment.BB_DATA_DIR?.trim();
  if (configured === undefined || configured === "") {
    return path.join(homeDirectory, ".bb");
  }
  if (configured === "~") return homeDirectory;
  if (configured.startsWith("~/")) {
    return path.join(homeDirectory, configured.slice(2));
  }
  if (!path.isAbsolute(configured)) {
    throw new Error(`BB_DATA_DIR is not an absolute path: ${configured}`);
  }
  return path.resolve(configured);
}

export function createMaintenanceClient(cli, dataDir, execute = run) {
  const call = (args) => {
    const result = execute(
      cli,
      ["maintenance", "--data-dir", dataDir, "--json", ...args],
      {
        capture: true,
        env: { BB_CLI: cli, BB_MAINTENANCE_OWNER_SECRET: undefined },
      },
    );
    try {
      return JSON.parse(result.stdout);
    } catch (error) {
      throw new Error(`cannot parse bb maintenance output: ${result.stdout}`, {
        cause: error,
      });
    }
  };
  return {
    identity: () => call(["identity"]),
    status: () => call(["status"]),
    acquire: (operationId) =>
      call([
        "acquire",
        "--reason",
        "desktop local update",
        "--operation-id",
        operationId,
      ]),
    seal: (operationId, { candidate, previous }) =>
      call([
        "seal",
        operationId,
        "--candidate",
        candidate,
        "--previous",
        previous,
        "--allow-active-work",
      ]),
    transition: (operationId, expectedPhase, phase) =>
      call(["transition", operationId, expectedPhase, phase]),
    release: (operationId, resolution) =>
      call(["release", operationId, "--resolution", resolution]),
  };
}

export function updateStatePath(dataDir) {
  return path.join(dataDir, "admin", "desktop-update.json");
}

export async function writeUpdateState(dataDir, state) {
  const file = updateStatePath(dataDir);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

export async function readUpdateState(dataDir) {
  const file = updateStatePath(dataDir);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (
    typeof parsed?.operationId !== "string" ||
    !Array.isArray(parsed.hostIds) ||
    !parsed.hostIds.every((hostId) => typeof hostId === "string") ||
    !(parsed.backupApp === null || typeof parsed.backupApp === "string")
  ) {
    throw new Error(`${file} is not a valid desktop update state file`);
  }
  return parsed;
}

export async function removeUpdateState(dataDir) {
  await rm(updateStatePath(dataDir), { force: true });
}

export function recoveryInstructions({ cli, dataDir, operationId, backupApp }) {
  const lines = [
    `If this update is interrupted, operation ${operationId} keeps bb Local work paused until it is released.`,
    "Recover with: pnpm desktop:local:update --recover (from Terminal or from inside bb Local; it stops the official bb.app, so never run it from inside that app)",
    "Or by hand, once a fork bb Local is running (skip the transition if the phase is already releasing):",
    `  "${cli}" maintenance --data-dir "${dataDir}" transition ${operationId} sealed releasing`,
    `  "${cli}" maintenance --data-dir "${dataDir}" release ${operationId} --resolution force-aborted`,
  ];
  if (backupApp !== null && backupApp !== undefined) {
    lines.push(
      `The previous app is at ${backupApp}; restore it over ${installedApp} if the installed app will not start.`,
    );
  }
  return lines.join("\n");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function cohortOfflineMessage(missing, detail) {
  return [
    `host daemon(s) ${missing.join(", ")} did not reconnect to bb Local${detail === null ? "" : ` (${detail})`}.`,
    "Until they do the update pause cannot be released: sends get a 503 and queued messages stay idle.",
    "Reconnect that host or restart its daemon, then run: pnpm desktop:local:update --recover",
  ].join("\n");
}

function releaseFailedMessage(error) {
  return [
    errorMessage(error),
    "The release failed although no paused host is known to be missing; inspect it with `bb maintenance status`, then run: pnpm desktop:local:update --recover",
  ].join("\n");
}

function isBarrierFailure(error) {
  return /HTTP 503|barrier_failed/u.test(errorMessage(error));
}

async function missingCohortHosts(client, hostIds) {
  try {
    const connected = new Set((await client.identity()).connectedHostIds);
    return hostIds.filter((hostId) => !connected.has(hostId));
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return null;
  }
}

async function waitForCohortHosts(client, hostIds, timing) {
  if (hostIds.length === 0) return;
  const deadline = timing.now() + timing.timeoutMs;
  let missing = hostIds;
  let lastError = null;
  while (true) {
    timing.interrupted();
    try {
      const identity = await client.identity();
      const connected = new Set(identity.connectedHostIds);
      missing = hostIds.filter((hostId) => !connected.has(hostId));
      lastError = null;
      if (missing.length === 0) return;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      lastError = errorMessage(error);
    }
    if (timing.now() >= deadline) {
      throw new Error(cohortOfflineMessage(missing, lastError));
    }
    await timing.sleep(timing.intervalMs);
  }
}

async function releaseWithRetry(
  client,
  operationId,
  resolution,
  hostIds,
  timing,
) {
  const deadline = timing.now() + timing.timeoutMs;
  while (true) {
    timing.interrupted();
    try {
      await client.release(operationId, resolution);
      return;
    } catch (error) {
      if (!isBarrierFailure(error)) throw error;
      if (timing.now() >= deadline) {
        const missing = await missingCohortHosts(client, hostIds);
        throw new Error(
          missing !== null && missing.length > 0
            ? `${errorMessage(error)}\n${cohortOfflineMessage(missing, null)}`
            : releaseFailedMessage(error),
          { cause: error },
        );
      }
    }
    await timing.sleep(timing.intervalMs);
  }
}

export async function releaseLease(
  client,
  { operationId, hostIds, resolution },
  timing = {},
) {
  const resolved = {
    timeoutMs: 120_000,
    intervalMs: 1_000,
    now: Date.now,
    sleep: (milliseconds) => delay(milliseconds),
    interrupted: throwIfInterrupted,
    ...timing,
  };
  const { lease } = await client.status();
  if (lease === null) return "none";
  if (lease.operationId !== operationId) {
    throw new Error(
      `maintenance is held by ${lease.operationId}, not ${operationId}; leaving it alone`,
    );
  }
  const phase = lease.phase;
  if (!["draining", "sealing", "sealed", "releasing"].includes(phase)) {
    throw new Error(
      `maintenance operation ${operationId} is in phase ${phase}, which this updater does not release; resolve it with bb maintenance`,
    );
  }
  await waitForCohortHosts(client, hostIds, resolved);
  const finalResolution =
    phase === "draining" || phase === "sealing" ? "force-aborted" : resolution;
  if (phase === "sealed") {
    await client.transition(operationId, "sealed", "releasing");
  }
  await releaseWithRetry(
    client,
    operationId,
    finalResolution,
    hostIds,
    resolved,
  );
  return phase;
}

export async function pauseWork(
  client,
  { dataDir, previous, candidate, now = new Date() },
  timing = {},
) {
  const operationId = `desktop-update-${now.toISOString().replace(/[:.]/gu, "-")}`;
  const abortPause = async (error, hostIds) => {
    beginCleanup();
    try {
      await releaseLease(
        client,
        { operationId, hostIds, resolution: "force-aborted" },
        timing,
      );
      await removeUpdateState(dataDir);
    } catch (releaseError) {
      throw new Error(
        [
          errorMessage(error),
          `Also could not release the pause: ${errorMessage(releaseError)}`,
          recoveryInstructions({
            cli: installedBbLocalCli,
            dataDir,
            operationId,
            backupApp: null,
          }),
        ].join("\n"),
        { cause: error },
      );
    }
    throw error;
  };
  let acquired;
  try {
    acquired = await client.acquire(operationId);
  } catch (error) {
    if (interruption.signal !== null) await abortPause(error, []);
    throw error;
  }
  const acquiredHostIds = acquired.barrier.map((host) => host.hostId);
  await writeUpdateState(dataDir, {
    operationId,
    hostIds: acquiredHostIds,
    backupApp: null,
  });
  let sealed;
  try {
    sealed = await client.seal(operationId, { candidate, previous });
  } catch (error) {
    await abortPause(error, acquiredHostIds);
  }
  const sealedHostIds = sealed.barrier.map((host) => host.hostId);
  const hostIds = sealedHostIds.length > 0 ? sealedHostIds : acquiredHostIds;
  await writeUpdateState(dataDir, { operationId, hostIds, backupApp: null });
  return { operationId, hostIds };
}

async function readUpdateStateOrNull(dataDir) {
  try {
    return await readUpdateState(dataDir);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return null;
  }
}

export async function recoverLeftoverLease(
  client,
  { dataDir, hasOwnerFile, during = "update", log = console.log },
  timing = {},
) {
  const { lease } = await client.status();
  if (lease === null) {
    await removeUpdateState(dataDir);
    return false;
  }
  const operationId = lease.operationId;
  const owned =
    operationId.startsWith("desktop-update-") &&
    (await hasOwnerFile(operationId));
  if (!owned) {
    throw new Error(
      `bb Local is in maintenance (operation ${operationId}, phase ${lease.phase}: ${lease.reason}) held by something other than this updater. Inspect it with "${installedBbLocalCli}" maintenance --data-dir "${dataDir}" status (see docs/linux-arm64-vps.md), resolve it, then ${during === "recover" ? "run --recover again if it was a desktop update pause" : "run the update again"}.`,
    );
  }
  const state = await readUpdateStateOrNull(dataDir);
  if (state === null || state.operationId !== operationId) {
    throw new Error(
      [
        `bb Local is paused by operation ${operationId} (phase ${lease.phase}), but the update state file is missing or unreadable, so the paused hosts are unknown.`,
        recoveryInstructions({
          cli: installedBbLocalCli,
          dataDir,
          operationId,
          backupApp: null,
        }),
      ].join("\n"),
    );
  }
  log(`Releasing leftover desktop update pause ${operationId}`);
  await releaseLease(
    client,
    { operationId, hostIds: state.hostIds, resolution: "force-aborted" },
    timing,
  );
  await removeUpdateState(dataDir);
  return true;
}

export async function recoverLocalApp({
  swapped,
  activated,
  backupApp,
  stopLocal,
  restoreBackup,
  startLocal,
}) {
  if (activated) return;
  if (swapped && backupApp !== null) {
    await stopLocal();
    await restoreBackup(backupApp);
  }
  await startLocal();
}

function combinedFailure(problems, recoveryText) {
  const [first, ...rest] = problems;
  return new Error(
    [
      errorMessage(first),
      ...rest.map((problem) => `Also: ${errorMessage(problem)}`),
      recoveryText,
    ].join("\n\n"),
    { cause: first },
  );
}

export async function runPausedUpdate(steps) {
  const lease = await steps.pause();
  const checkpoint = async () => {
    await new Promise(setImmediate);
    steps.throwIfInterrupted();
  };
  let failure = null;
  try {
    if (lease !== null) {
      await checkpoint();
      await steps.quit();
    }
    await checkpoint();
    await steps.build();
    await checkpoint();
    await steps.swap();
    await checkpoint();
    await steps.syncPlugins();
    await checkpoint();
  } catch (error) {
    failure = error;
  }
  steps.beginCleanup();
  if (lease === null) {
    if (failure !== null) throw failure;
    return;
  }
  if (failure === null) {
    try {
      await steps.release("completed");
    } catch (error) {
      throw combinedFailure(
        [error],
        `${steps.recoveryText()}\nThe update finished but the pause was not released, so any fork push was skipped.`,
      );
    }
    return;
  }
  const problems = [failure];
  let localRunning = true;
  try {
    await steps.recoverLocal();
  } catch (error) {
    localRunning = false;
    problems.push(error);
  }
  if (localRunning) {
    try {
      await steps.release("force-aborted");
    } catch (error) {
      problems.push(error);
    }
  }
  if (problems.length === 1) throw failure;
  throw combinedFailure(problems, steps.recoveryText());
}

function repositoryIsMidRebase() {
  return ["rebase-merge", "rebase-apply"].some((name) =>
    existsSync(
      path.resolve(
        repoRoot,
        gitOutput(["rev-parse", "--git-path", name]).stdout,
      ),
    ),
  );
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function prepareBbLocalServer(dataDir) {
  await ensureOfficialStopped("bb Local must own the server port");
  await ensureLocalAppRunning();
  if ((await executableRealPath(installedBbLocalCli)) === null) {
    throw new Error(`bb Local CLI is not executable: ${installedBbLocalCli}`);
  }
  const client = createMaintenanceClient(installedBbLocalCli, dataDir);
  try {
    await client.identity();
  } catch (error) {
    throw new Error(
      `bb Local's maintenance socket is not reachable; nothing was changed\n${errorMessage(error)}`,
      { cause: error },
    );
  }
  return client;
}

function leftoverLeaseOptions(dataDir) {
  return {
    dataDir,
    hasOwnerFile: (operationId) =>
      pathExists(
        path.join(dataDir, "admin", "operations", `${operationId}.json`),
      ),
  };
}

async function recoverDesktopUpdate() {
  const dataDir = resolveDataDir();
  const state = await readUpdateStateOrNull(dataDir);
  if (!(await pathExists(installedApp))) {
    throw new Error(
      state?.backupApp
        ? `${installedApp} is not installed; the previous app is at ${state.backupApp}. Move it to ${installedApp}, then run --recover again`
        : `${installedApp} is not installed; nothing to recover`,
    );
  }
  let client;
  try {
    client = await prepareBbLocalServer(dataDir);
  } catch (error) {
    if (state?.backupApp) {
      console.error(
        `The previous app is at ${state.backupApp}; restore it over ${installedApp} if the installed app will not start.`,
      );
    }
    throw error;
  }
  const released = await recoverLeftoverLease(client, {
    ...leftoverLeaseOptions(dataDir),
    during: "recover",
  });
  console.log(
    released
      ? "Threads resumed; interrupted turns retry where provider-retry applies."
      : "No desktop update pause to recover.",
  );
}

async function runStep(command, args, options) {
  const result = run(command, args, options);
  await checkpoint();
  return result;
}

async function buildLocalApp(upstreamRef) {
  if (upstreamRef !== null) {
    const upstreamIsAncestor = gitOutput(
      ["merge-base", "--is-ancestor", upstreamRef, "HEAD"],
      { allowFailure: true },
    );
    if (upstreamIsAncestor.status !== 0) {
      await runStep("git", ["rebase", upstreamRef]);
    }
  }
  if (upstreamRef !== null) requireCleanWorktree();
  const patches =
    upstreamRef === null ? null : countCommits(`${upstreamRef}..HEAD`);
  await runStep("pnpm", ["install", "--frozen-lockfile"]);
  await runStep("node", [
    "--test",
    "--test-concurrency=1",
    "scripts/update-local-desktop.fork.test.mjs",
  ]);
  await runStep("pnpm", ["desktop:local:package"]);
  await runStep("pnpm", ["--filter", "@bb/desktop", "smoke:packaged"], {
    env: { BB_DESKTOP_LOCAL_BUILD: "1" },
  });
  const teamIdentifier = readTeamIdentifier(packagedApp);
  if (teamIdentifier !== null) {
    console.log(
      `Keeping Team ID signature (${teamIdentifier}) on ${packagedApp}`,
    );
  } else {
    console.log("No Team ID signature; ad-hoc signing the packaged app");
    await runStep("codesign", [
      "--force",
      "--deep",
      "--sign",
      "-",
      packagedApp,
    ]);
  }
  await runStep("codesign", ["--verify", "--deep", "--strict", packagedApp]);
  return patches;
}

function readTeamIdentifier(appPath) {
  const details = run("codesign", ["-dv", appPath], {
    allowFailure: true,
    capture: true,
  });
  if (details.status !== 0) return null;
  const teamIdentifier = /^TeamIdentifier=(.+)$/mu.exec(details.stderr)?.[1];
  return teamIdentifier === undefined || teamIdentifier === "not set"
    ? null
    : teamIdentifier;
}

async function syncResolvedPlugins(cli, externalPlugins) {
  console.log(
    `Syncing ${externalPlugins.length} external plugin(s): ${externalPlugins
      .map((plugin) => plugin.id)
      .join(", ")}`,
  );
  const outcomes = await readCollectionOutcomes(desktopPluginCommand(cli));
  for (const plugin of externalPlugins) {
    syncExternalPlugin(cli, plugin, outcomes);
    await checkpoint();
  }
  await removeUnlistedCollectionPlugins(
    cli,
    externalPluginCollections,
    externalPlugins,
  );
}

function desktopPluginCommand(cli) {
  return (args, options = {}) =>
    run(cli, args, {
      env: { BB_CLI: cli },
      capture: options.capture,
      timeoutMs: options.timeoutMs,
    });
}

export async function interruptCheckpoint() {
  await new Promise(setImmediate);
  if (interruption.signal !== null) {
    throw new Error(`interrupted by ${interruption.signal}`);
  }
}

const otherPluginIdPattern = /^[a-z0-9][a-z0-9-]*$/u;

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

const outdatedReadTimeoutMs = 120_000;

function readOutdatedEntries(command, timeoutMs) {
  return JSON.parse(
    command(["plugin", "outdated", "--json"], { capture: true, timeoutMs })
      .stdout,
  );
}

export function readPluginOutcomes(
  command,
  { readTimeoutMs = outdatedReadTimeoutMs, warn = console.warn } = {},
) {
  try {
    const entries = readOutdatedEntries(command, readTimeoutMs);
    if (!Array.isArray(entries)) {
      throw new Error("plugin outdated did not return a list");
    }
    return new Map(
      entries
        .filter(
          (entry) =>
            entry !== null &&
            typeof entry === "object" &&
            typeof entry.id === "string" &&
            typeof entry.outcome === "string",
        )
        .map((entry) => [entry.id, entry.outcome]),
    );
  } catch (error) {
    warn(`Updating every collection plugin: ${describeError(error)}`);
    return new Map();
  }
}

export async function readCollectionOutcomes(
  command,
  { turn = checkpoint, warn = console.warn } = {},
) {
  const warnings = [];
  const outcomes = readPluginOutcomes(command, {
    warn: (line) => warnings.push(line),
  });
  await turn();
  for (const line of warnings) warn(line);
  return outcomes;
}

export async function updateOtherPlugins(
  skipIds,
  {
    command,
    readTimeoutMs = outdatedReadTimeoutMs,
    updateTimeoutMs = 600_000,
    readOutdated = async () => readOutdatedEntries(command, readTimeoutMs),
    isInterrupted = () => false,
    checkpoint = async () => {},
    log = console.log,
    warn = console.warn,
  },
) {
  const skip = new Set(skipIds);
  const read = async (stage) => {
    await checkpoint();
    try {
      const entries = await readOutdated();
      if (!Array.isArray(entries)) {
        throw new Error("plugin outdated did not return a list");
      }
      return entries;
    } catch (error) {
      await checkpoint();
      if (isInterrupted()) throw error;
      warn(`${stage}: ${describeError(error)}`);
      return null;
    }
  };
  const entries = await read("Skipping other plugin updates");
  if (entries === null) return { attempted: [], failed: [] };
  const others = entries.filter(
    (entry) =>
      entry !== null &&
      typeof entry === "object" &&
      typeof entry.id === "string" &&
      !skip.has(entry.id),
  );
  const unavailable = others
    .filter(
      (entry) =>
        entry.outcome === "unavailable" || entry.outcome === "incompatible",
    )
    .map(
      (entry) =>
        `${otherPluginIdPattern.test(entry.id) ? entry.id : JSON.stringify(entry.id)} (${entry.outcome})`,
    );
  if (unavailable.length > 0) {
    log(`Other plugins without a compatible update: ${unavailable.join(", ")}`);
  }
  const available = others.filter(
    (entry) => entry.outcome === "update-available",
  );
  const unsupported = available.filter(
    (entry) => !otherPluginIdPattern.test(entry.id),
  );
  if (unsupported.length > 0) {
    warn(
      `Skipping other plugin update(s) with an unsupported id: ${unsupported
        .map((entry) => JSON.stringify(entry.id))
        .join(", ")}`,
    );
  }
  const pending = available.filter((entry) =>
    otherPluginIdPattern.test(entry.id),
  );
  if (pending.length === 0) {
    log("No other plugin updates.");
    return { attempted: [], failed: [] };
  }
  log(
    `Updating ${pending.length} other plugin(s): ${pending
      .map(
        (entry) =>
          `${entry.id} ${entry.installed?.display ?? "installed"} → ${entry.candidate?.display ?? "latest compatible"}`,
      )
      .join(", ")}`,
  );
  const attempted = [];
  const failed = [];
  for (const { id } of pending) {
    await checkpoint();
    attempted.push(id);
    try {
      command(["plugin", "update", "--yes", id], {
        timeoutMs: updateTimeoutMs,
      });
    } catch (error) {
      await checkpoint();
      if (isInterrupted()) throw error;
      failed.push(id);
      warn(
        error?.code === "ETIMEDOUT"
          ? `Plugin ${id} update timed out after ${updateTimeoutMs / 1000}s; the server-side update may still finish`
          : `Plugin ${id} update failed: ${describeError(error)}`,
      );
    }
  }
  const remaining = await read("Could not verify other plugin updates");
  if (remaining !== null) {
    const reported = new Map();
    for (const entry of remaining) {
      if (entry !== null && typeof entry === "object") {
        reported.set(entry.id, entry);
      }
    }
    for (const id of attempted) {
      if (failed.includes(id)) continue;
      const entry = reported.get(id);
      if (entry === undefined) {
        failed.push(id);
        warn(
          `Plugin ${id} is no longer installed or was not reported after its update`,
        );
      } else if (entry.outcome === "update-available") {
        failed.push(id);
        warn(`Plugin ${id} still has an update available`);
      } else if (entry.outcome !== "current") {
        failed.push(id);
        warn(`Plugin ${id} did not update (${JSON.stringify(entry.outcome)})`);
      }
    }
  }
  if (failed.length > 0) {
    warn(
      `Other plugin updates incomplete: ${failed.join(", ")}; see the output above for reasons`,
    );
  }
  return { attempted, failed };
}

export async function resolvePluginsOnlyCli(
  environment = process.env,
  {
    bbLocalCli = installedBbLocalCli,
    resolve = resolveBbCli,
    isExecutable = executableRealPath,
  } = {},
) {
  const explicit = environment.BB_CLI?.trim();
  if (
    (explicit === undefined || explicit === "") &&
    (await isExecutable(bbLocalCli)) !== null
  ) {
    return bbLocalCli;
  }
  return resolve(environment);
}

export async function readPluginsOnlyUpdateState(dataDir = resolveDataDir()) {
  try {
    return await readUpdateState(dataDir);
  } catch (error) {
    if (!(await pathExists(updateStatePath(dataDir)))) throw error;
    return { operationId: "unknown (unreadable state file)" };
  }
}

export async function syncPluginsOnly({
  resolveCli = resolvePluginsOnlyCli,
  readSource = readPluginSource,
  readState = readPluginsOnlyUpdateState,
  resolvePlugins = resolveExternalPlugins,
  sync = syncResolvedPlugins,
  otherPlugins = true,
  updateOthers = (cli, skipIds) =>
    updateOtherPlugins(skipIds, {
      command: desktopPluginCommand(cli),
      isInterrupted: interruptRequested,
      checkpoint: interruptCheckpoint,
    }),
} = {}) {
  const state = await readState();
  if (state !== null) {
    throw new Error(
      `a desktop update (operation ${state.operationId}) is in progress or was interrupted and may have left bb Local paused; if no update is running, run pnpm desktop:local:update -- --recover first`,
    );
  }
  const cli = await resolveCli();
  console.log(`Using bb CLI: ${cli}`);
  try {
    readSource(cli, "shared-runtime");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `cannot reach a BB server through ${cli}; start bb Local (or bb), or set BB_CLI to the running bb's CLI\n${detail}`,
      { cause: error },
    );
  }
  const plugins = await resolvePlugins(externalPluginCollections);
  await sync(cli, plugins);
  console.log(
    `Synced ${plugins.length} external plugin(s) from ${externalPluginCollections
      .map((collection) => collection.source)
      .join(", ")}: ${plugins.map((plugin) => plugin.id).join(", ")}`,
  );
  if (otherPlugins) {
    await updateOthers(
      cli,
      plugins.map((plugin) => plugin.id),
    );
  }
}

async function prepareInstall(dataDir) {
  installSignalHandlers();
  if (!(await pathExists(installedApp))) {
    console.log(
      `${installedApp} is not installed; installing without pausing threads`,
    );
    return null;
  }
  const client = await prepareBbLocalServer(dataDir);
  await recoverLeftoverLease(client, leftoverLeaseOptions(dataDir));
  return client;
}

const defaultInstallActions = {
  installApp: installPackagedApp,
  startLocal: startLocalApp,
  stopLocal: stopLocalApp,
  restoreBackup: restoreBackupApp,
  ensureLocalRunning: ensureLocalAppRunning,
  ensureOfficialStopped,
};

const fallbackRecoveryText =
  "If the update pause is still held, run: pnpm desktop:local:update --recover";

export async function runInstallUpdate({
  client,
  dataDir,
  upstreamRef,
  options,
  build,
  syncPlugins,
  actions = defaultInstallActions,
}) {
  let lease = null;
  let swapped = false;
  let activated = false;
  let backupApp = null;
  const stopOfficial = () =>
    actions.ensureOfficialStopped("official bb ignores the update pause");
  const recoveryText = () =>
    recoveryInstructions({
      cli: installedBbLocalCli,
      dataDir,
      operationId: lease.operationId,
      backupApp,
    });
  try {
    await runPausedUpdate({
      pause: async () => {
        if (client === null) return null;
        setInterruptRecoveryText(fallbackRecoveryText);
        const previous = gitOutput(["rev-parse", "HEAD"]).stdout;
        const candidate =
          upstreamRef === null
            ? previous
            : gitOutput(["rev-parse", upstreamRef]).stdout;
        lease = await pauseWork(client, { dataDir, previous, candidate });
        setInterruptRecoveryText(recoveryText());
        console.log(
          `Paused bb Local threads: running local turns are interrupted and retried where provider-retry applies; turns already running on remote hosts continue. Paused hosts (keep these machines awake until the pause is released): ${lease.hostIds.join(", ")}. Don't open bb.app until the update finishes.`,
        );
        console.log(recoveryText());
        return lease;
      },
      quit: async () => {
        console.log("Quitting bb Local");
        await actions.stopLocal();
      },
      build: async () => {
        await build();
        await stopOfficial();
      },
      swap: async () => {
        if (lease !== null) {
          backupApp = backupAppPath();
          await writeUpdateState(dataDir, {
            operationId: lease.operationId,
            hostIds: lease.hostIds,
            backupApp,
          });
          setInterruptRecoveryText(recoveryText());
        }
        await installAndActivateLocalApp({
          install: async () => {
            await actions.installApp(backupApp ?? backupAppPath());
            swapped = true;
          },
          startLocal: async () => {
            await actions.startLocal();
            activated = true;
          },
          stopOfficial,
        });
      },
      syncPlugins: async () => {
        if (!options.plugins) return;
        if (lease !== null) {
          console.log(
            "bb Local is open but paused until the plugin sync finishes.",
          );
        }
        await syncPlugins();
      },
      recoverLocal: () =>
        recoverLocalApp({
          swapped,
          activated,
          backupApp,
          stopLocal: actions.stopLocal,
          restoreBackup: actions.restoreBackup,
          startLocal: actions.ensureLocalRunning,
        }),
      release: async (resolution) => {
        try {
          await stopOfficial();
        } catch (error) {
          console.warn(errorMessage(error));
        }
        await releaseLease(client, {
          operationId: lease.operationId,
          hostIds: lease.hostIds,
          resolution,
        });
        await removeUpdateState(dataDir);
        console.log(
          resolution === "completed"
            ? "Threads resumed; interrupted turns retry where provider-retry applies."
            : "The update failed; paused work was released (force-aborted).",
        );
      },
      recoveryText,
      throwIfInterrupted,
      beginCleanup,
    });
  } catch (error) {
    if (repositoryIsMidRebase()) {
      console.error(
        "The repository is mid-rebase; resolve it with git rebase --continue or git rebase --abort",
      );
    }
    throw error;
  }
}

export async function updateLocalDesktop(argv) {
  const options = parseLocalUpdateArgs(argv);
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error(
      "the local desktop updater currently supports Apple Silicon macOS only",
    );
  }
  if (options.pluginsOnly) {
    await syncPluginsOnly({ otherPlugins: options.otherPlugins });
    return;
  }
  if (options.recover) {
    await recoverDesktopUpdate();
    return;
  }
  if (options.install && !options.check) assertNotInsideBb();
  const { branch, status } = requireCleanWorktree({
    allowDirty: options.current,
  });
  let remotes = null;
  let previousForkHead = null;
  let upstreamRef = null;
  let revision = null;
  if (options.current) {
    revision = `${gitOutput(["rev-parse", "--short", "HEAD"]).stdout}${status === "" ? "" : "-dirty"}`;
    console.log(
      `Branch ${branch}: current checkout ${revision} (fetch and rebase skipped)`,
    );
    if (status !== "") console.log(`Uncommitted changes:\n${status}`);
    if (options.check) return;
    if (options.push && status !== "") {
      throw new Error(
        "pushing would publish HEAD without the uncommitted changes that this build installs; commit them or use --skip-push",
      );
    }
    if (options.push) {
      if (branch !== forkBranch) {
        throw new Error(
          `current checkout branch ${branch} does not match push target ${forkBranch}; use --skip-push to update from this checkout without rewriting ${forkBranch}`,
        );
      }
      remotes = { fork: activeForkRemote() };
      previousForkHead = remoteHead(remotes.fork);
      if (previousForkHead === null) {
        throw new Error(
          `current checkout mode cannot safely push without refs/remotes/${remotes.fork}/${forkBranch}; fetch the fork first or use --skip-push`,
        );
      }
    }
  } else {
    remotes = activeRemotes();
    run("git", ["fetch", remotes.upstream, upstreamBranch]);
    run("git", ["fetch", remotes.fork, forkBranch]);
    previousForkHead = remoteHead(remotes.fork);
    upstreamRef = `${remotes.upstream}/${upstreamBranch}`;
    const behind = countCommits(`HEAD..${upstreamRef}`);
    const initialPatches = countCommits(`${upstreamRef}..HEAD`);
    console.log(
      `Branch ${branch}: ${behind} upstream commit(s), ${initialPatches} local patch commit(s)`,
    );
    if (options.check) return;
  }
  const dataDir = resolveDataDir();
  const client = options.install ? await prepareInstall(dataDir) : null;
  const cli = !options.plugins
    ? null
    : options.install
      ? installedBbLocalCli
      : await resolveBbCli();
  let externalPlugins = [];
  if (options.plugins) {
    if (!options.install) {
      await ensurePluginServerAvailable({
        readSource: (id) => readPluginSource(cli, id),
      });
    } else if (client !== null) {
      readPluginSource(cli, "shared-runtime");
    }
    externalPlugins = await resolveExternalPlugins(externalPluginCollections);
  }
  let patches = null;
  const build = async () => {
    patches = await buildLocalApp(upstreamRef);
  };
  const syncPlugins = () => syncResolvedPlugins(cli, externalPlugins);
  if (options.install) {
    await runInstallUpdate({
      client,
      dataDir,
      upstreamRef,
      options,
      build,
      syncPlugins,
    });
  } else {
    await build();
    if (options.plugins) await syncPlugins();
  }
  beginPostReleaseInterrupts();
  if (options.push) {
    if (remotes === null) throw new Error("fork remote was not resolved");
    run("git", pushArguments(previousForkHead, remotes.fork));
  }
  console.log(
    options.current
      ? `bb Local updated from current checkout ${revision}`
      : `bb Local updated from ${upstreamRef} and ${patches} local patch commit(s)`,
  );
  if (options.plugins && options.otherPlugins) {
    await updateOtherPlugins(
      externalPlugins.map((plugin) => plugin.id),
      {
        command: desktopPluginCommand(cli),
        isInterrupted: interruptRequested,
        checkpoint: interruptCheckpoint,
      },
    );
  }
}
