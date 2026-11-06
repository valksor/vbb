import { setPluginEnvironmentProviderBridge } from "../../../src/services/plugins/plugin-environment-provider-registry.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSystemProviderInfos } from "../../../src/services/system/execution-options.js";
import { withTestHarness } from "../../helpers/test-app.js";

async function writePlugin(
  dir: string,
  options: {
    icons?: Record<string, string>;
    bridgeSource?: string;
    name: string;
    serverSource: string;
    withBridge?: boolean;
  },
): Promise<string> {
  const withBridge = options.withBridge ?? true;
  const rootDir = join(dir, options.name);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: "0.1.0",
      bb: {
        name: "Provider fixture",
        description: "Provider registration plugin fixture.",
        branding: {
          icon: "Zap",
          ...(options.icons === undefined
            ? {}
            : { experimental_icons: options.icons }),
        },
        server: "./server.ts",
        ...(withBridge ? { host: "./bridge.ts" } : {}),
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  if (withBridge) {
    await writeFile(
      join(rootDir, "bridge.ts"),
      options.bridgeSource ??
        "export const experimental_providerBridge = { experimental_apiVersion: 1, handleLine: () => undefined };\n",
    );
  }
  return rootDir;
}

const REGISTER_PROVIDER_SOURCE = (id: string): string => `
  export default function plugin(bb: any) {
    bb.providers.register({
      id: ${JSON.stringify(id)},
      displayName: "My Remote Agent",
      icon: "./icons/agent.svg",
      maintenance: { health: true, usage: true, installation: false },
      capabilities: {
        supportsServiceTier: true,
        supportsNativeUserQuestion: true,
        fork: "tip",
        supportsManualCompaction: true,
        supportsThreadArchive: false,
        supportsThreadRename: false,
        permissionModes: ["accept-edits", "full"],
        reasoningLevels: ["low", "medium", "high"],
      },
      composerActions: ["plan"],
    });
  }
`;

describe("bb.providers.register (server)", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-provider-test-"));
  });

  afterEach(async () => {
    setPluginEnvironmentProviderBridge(undefined);
    await rm(workDir, { recursive: true, force: true });
  });

  it("serves a data URI icon through the provider logo route", async () => {
    await withTestHarness(async (harness) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path d="M0 0h4v4z"/></svg>`;
      const rootDir = await writePlugin(workDir, {
        name: "bb-plugin-inline-agent",
        serverSource: REGISTER_PROVIDER_SOURCE("inline-agent").replace(
          '"./icons/agent.svg"',
          JSON.stringify(
            `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
          ),
        ),
      });
      const entry = await harness.pluginService.installPath(rootDir);
      expect(entry.status, entry.statusDetail ?? "").toBe("running");

      const provider = (await listSystemProviderInfos(harness.deps, {})).find(
        (info) => info.id === "inline-agent",
      );
      expect(provider?.icon).toBeUndefined();
      expect(provider?.logoUrl).toMatch(
        /^\/api\/v1\/system\/providers\/inline-agent\/logo\?h=/u,
      );
      const logo = await harness.app.request(
        `http://127.0.0.1:3334${provider?.logoUrl ?? ""}`,
      );
      expect(logo.status).toBe(200);
      expect(logo.headers.get("content-type")).toBe("image/svg+xml");
      expect(await logo.text()).toBe(svg);
    });
  });
});
