import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { z } from "zod";
import { CUSTOM_AGENT_DECLARED_ICON_NAMES } from "./src/agents.icons.fork.js";
import { parseCustomAcpAgents } from "./src/agents.js";
import { RESERVED_ACP_PROVIDER_IDS } from "./src/known-agents.js";
import acpProvidersPlugin from "./server.js";

const PLUGIN_ID = "provider-acp";

const DECLARED_ICON_NAMES = Object.keys(
  z
    .object({
      bb: z.object({
        branding: z.object({
          experimental_icons: z.record(z.string(), z.string()),
        }),
      }),
    })
    .parse(
      JSON.parse(
        readFileSync(new URL("./package.json", import.meta.url), "utf8"),
      ),
    ).bb.branding.experimental_icons,
);

function customAgents(...agents: unknown[]): string {
  return JSON.stringify(agents);
}

function registeredIds(
  host: ReturnType<typeof createFakePluginHost>,
): string[] {
  return host.harness.registrations.providerRegistrations.map(
    (declaration) => declaration.id,
  );
}

async function loadPlugin(options: {
  customAgents?: string;
  probe?: (command: string) => unknown;
  hosts?: { id: string; status: string }[];
}) {
  const host = createFakePluginHost({
    pluginId: PLUGIN_ID,
    experimental_declaredIconNames: DECLARED_ICON_NAMES,
    ...(options.customAgents === undefined
      ? {}
      : { settings: { customAgents: options.customAgents } }),
    ...(options.probe === undefined
      ? {}
      : {
          experimental_callHostRpc: (call: { input: unknown }) =>
            options.probe?.(
              (call.input as { command: string }).command,
            ) as never,
        }),
  });
  host.harness.sdk.stub("hosts.list", () =>
    Promise.resolve(options.hosts ?? []),
  );
  host.harness.sdk.stub("providers.catalog", () => Promise.resolve([]));
  await acpProvidersPlugin(host.bb);
  return host;
}

describe("the ACP plugin's registrations", () => {
  it("accepts every icon declared by its manifest", () => {
    expect(new Set(CUSTOM_AGENT_DECLARED_ICON_NAMES)).toEqual(
      new Set(DECLARED_ICON_NAMES),
    );
    const parsed = parseCustomAcpAgents({
      entries: DECLARED_ICON_NAMES.map((name) => ({
        id: `icon-${name}`,
        displayName: name,
        command: "agent",
        icon: `provider-acp/${name}`,
      })),
      reservedProviderIds: RESERVED_ACP_PROVIDER_IDS,
    });

    expect(parsed.problems).toEqual([]);
    expect(parsed.agents).toHaveLength(DECLARED_ICON_NAMES.length);
  });

  it("registers custom provider marks and updates them with the setting", async () => {
    const host = await loadPlugin({
      customAgents: customAgents({
        id: "glm",
        displayName: "GLM",
        command: "glm",
        icon: "provider-acp/glm",
      }),
    });

    const glmIcon = () =>
      host.harness.registrations.providerRegistrations.find(
        (declaration) => declaration.id === "acp-glm",
      )?.icon;
    expect(glmIcon()).toBe("provider-acp/glm");

    await host.harness.setSettings({
      customAgents: customAgents({
        id: "glm",
        displayName: "GLM",
        command: "glm",
        icon: "provider-acp/claude",
      }),
    });
    await vi.waitFor(() => expect(glmIcon()).toBe("provider-acp/claude"));
  });

  it("replaces a shipped installed-only agent with a configured one", async () => {
    const host = await loadPlugin({
      customAgents: customAgents({
        id: "opencode",
        displayName: "My opencode",
        command: "/opt/opencode",
      }),
    });

    const opencode = host.harness.registrations.providerRegistrations.filter(
      (declaration) => declaration.id === "acp-opencode",
    );
    expect(opencode).toHaveLength(1);
    expect(opencode[0]?.displayName).toBe("My opencode");
    expect(opencode[0]?.icon).toBe("provider-acp/opencode");
  });
});

describe("the ACP plugin's registration bookkeeping", () => {
  it("refuses to save an icon file that cannot be read", async () => {
    const host = await loadPlugin({ customAgents: "[]" });

    await expect(
      host.harness.setSettings({
        customAgents: customAgents({
          id: "amp",
          displayName: "Amp",
          command: "amp",
          icon: "/nonexistent/bb-acp-icon.svg",
        }),
      }),
    ).rejects.toThrow(/icon file \/nonexistent\/bb-acp-icon\.svg/u);
    expect(registeredIds(host)).not.toContain("acp-amp");
  });
});
