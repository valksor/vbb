import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const smokeTarballSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../scripts/smoke-tarball.mjs"),
  "utf8",
);

describe("smoke-tarball timing labels", () => {
  it("labels the SDK typecheck step as a plain typescript check in both smoke modes", () => {
    expect(smokeTarballSource).toContain('timed("typescript check"');
    expect(smokeTarballSource).not.toContain("npx typescript check");
  });
});

import { afterEach } from "vitest";
// @ts-expect-error smoke helper is JavaScript without declarations
import { createSmokeEnvironment, parseSingleNpmPackEntry } from "../scripts/smoke-tarball.fork.mjs";

const workspaceArtifactsEnvironment = "BB_APP_SMOKE_USE_WORKSPACE_ARTIFACTS";
const originalWorkspaceArtifacts = process.env[workspaceArtifactsEnvironment];

afterEach(() => {
  if (originalWorkspaceArtifacts === undefined) {
    delete process.env[workspaceArtifactsEnvironment];
  } else {
    process.env[workspaceArtifactsEnvironment] = originalWorkspaceArtifacts;
  }
});

describe("smoke-tarball fork helpers", () => {
  it("sets defaults, preserves overrides, and gives telemetry policy precedence", () => {
    const smokeEnvironment = createSmokeEnvironment({
      smokeProcessEnv: { BB_TELEMETRY: "false" },
      tempRoot: "/smoke-root",
    });

    expect(smokeEnvironment({})).toMatchObject({
      BB_DATA_DIR: "/smoke-root/default-data",
      BB_TELEMETRY: "false",
    });
    const environment = smokeEnvironment({
      BB_DATA_DIR: "/overridden-data",
      BB_TELEMETRY: "true",
      HOME: "/external-home",
      NPM_CONFIG_IGNORE_SCRIPTS: "false",
      npm_config_userconfig: "/external-home/.npmrc",
    });
    expect(environment).toMatchObject({
      BB_DATA_DIR: "/overridden-data",
      BB_TELEMETRY: "false",
      HOME: "/external-home",
      npm_config_userconfig: "/external-home/.npmrc",
    });
    expect(environment).not.toHaveProperty("NPM_CONFIG_IGNORE_SCRIPTS");
  });

  it("selects the workspace compiler only when the named environment enables it", async () => {
    delete process.env[workspaceArtifactsEnvironment];
    // @ts-expect-error fresh JavaScript helper import has no declarations
    const withoutWorkspaceArtifacts = await import("../scripts/smoke-tarball.fork.mjs?workspace-artifacts=disabled");
    expect(withoutWorkspaceArtifacts.useWorkspaceArtifacts).toBe(false);
    expect(
      withoutWorkspaceArtifacts.workspaceTypescriptInvocation({
        packageRoot: "/workspace/packages/bb-app",
      }),
    ).toEqual({});

    process.env[workspaceArtifactsEnvironment] = "true";
    // @ts-expect-error fresh JavaScript helper import has no declarations
    const withWorkspaceArtifacts = await import("../scripts/smoke-tarball.fork.mjs?workspace-artifacts=enabled");
    expect(withWorkspaceArtifacts.useWorkspaceArtifacts).toBe(true);
    expect(
      withWorkspaceArtifacts.workspaceTypescriptInvocation({
        packageRoot: "/workspace/packages/bb-app",
      }),
    ).toEqual({
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
      command: "/workspace/node_modules/.bin/tsc",
    });
  });

  it("parses single npm-pack entries from array and object output", () => {
    const entry = { filename: "bb-app.tgz", files: [{ path: "package.json" }] };
    expect(parseSingleNpmPackEntry(JSON.stringify([entry]))).toEqual(entry);
    expect(parseSingleNpmPackEntry(JSON.stringify({ entry }))).toEqual(entry);
  });

  it("rejects malformed npm-pack output", () => {
    expect(() => parseSingleNpmPackEntry("not json")).toThrow(SyntaxError);
    expect(() => parseSingleNpmPackEntry(JSON.stringify([]))).toThrow(
      "Unexpected npm pack output",
    );
    expect(() => parseSingleNpmPackEntry(JSON.stringify({ entry: {} }))).toThrow(
      "Unexpected npm pack entry",
    );
  });
});
