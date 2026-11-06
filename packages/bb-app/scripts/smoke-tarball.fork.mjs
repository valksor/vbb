import { mkdirSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const useWorkspaceArtifacts =
  process.env.BB_APP_SMOKE_USE_WORKSPACE_ARTIFACTS === "true";

const inheritedNpmConfigKeys = new Set([
  "npm_config_allow_scripts",
  "npm_config_foreground_scripts",
  "npm_config_ignore_scripts",
  "npm_config_recursive",
]);

export function createSmokeEnvironment({ smokeProcessEnv, tempRoot }) {
  return function smokeEnvironment(overrides) {
    const environment = {
      ...process.env,
      BB_DATA_DIR: join(tempRoot, "default-data"),
      ...overrides,
      ...smokeProcessEnv,
    };
    for (const key of Object.keys(environment)) {
      if (inheritedNpmConfigKeys.has(key.toLowerCase())) {
        delete environment[key];
      }
    }
    return environment;
  };
}

export function normalizeNpmPackOutput(packed) {
  return Array.isArray(packed)
    ? packed
    : typeof packed === "object" && packed !== null
      ? Object.values(packed)
      : [];
}

export function parseSingleNpmPackEntry(stdout) {
  const entries = normalizeNpmPackOutput(JSON.parse(stdout));
  if (entries.length !== 1) {
    throw new Error(`Unexpected npm pack output: ${stdout}`);
  }
  const [entry] = entries;
  if (
    typeof entry !== "object" ||
    entry === null ||
    !Array.isArray(entry.files)
  ) {
    throw new Error(`Unexpected npm pack entry: ${stdout}`);
  }
  return entry;
}

export function createPackedBridgeEnvironment({ pluginId, tempRoot }) {
  const providerHome = join(tempRoot, "bridge-home", pluginId);
  const claudeConfigDir = join(providerHome, ".claude");
  const codexHome = join(providerHome, ".codex");
  const piAgentDir = join(providerHome, ".pi");
  for (const directory of [
    providerHome,
    claudeConfigDir,
    codexHome,
    piAgentDir,
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  return {
    ...process.env,
    CLAUDE_CONFIG_DIR: claudeConfigDir,
    CODEX_HOME: codexHome,
    HOME: providerHome,
    PI_CODING_AGENT_DIR: piAgentDir,
    USERPROFILE: providerHome,
  };
}

export async function installWorkspaceNativeArtifacts({ packageRoot, sdkDir }) {
  if (!useWorkspaceArtifacts) {
    return;
  }
  const nativeRelativePath = join(
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node",
  );
  const installedNativePath = join(sdkDir, "node_modules", nativeRelativePath);
  await mkdir(dirname(installedNativePath), { recursive: true });
  await copyFile(
    join(packageRoot, "node_modules", nativeRelativePath),
    installedNativePath,
  );
}

export function workspaceTypescriptInvocation({ packageRoot }) {
  if (!useWorkspaceArtifacts) {
    return {};
  }
  return {
    args: [
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "--noEmit",
      "sdk-smoke.ts",
    ],
    command: resolve(packageRoot, "../../node_modules/.bin/tsc"),
  };
}
