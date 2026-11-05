import { expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeHostResponse,
} from "@get-bb/plugin-sdk/testing";
import { registerUsageSource as plugin } from "./usage-source.js";
import {
  usageListMethod,
  usageFetchMethod,
  usageMeasurementSchema,
  usageResourceListSchema,
} from "./usage-contract.js";

it("lists and fetches a profile provider of its own plugin but not another plugin's", async () => {
  const collect = vi.fn(async () => ({
    "claude-code-work": {
      status: "ok" as const,
      accountEmail: "work@example.com",
      planLabel: null,
      windows: [],
    },
  }));
  const { bb, harness } = createFakePluginHost({
    sdk: {
      hosts: {
        list: async () => [
          makeHostResponse({ id: "host", status: "connected" }),
        ],
        get: async ({ hostId }) =>
          makeHostResponse({ id: hostId, status: "connected" }),
      },
      providers: {
        list: async () => [
          {
            id: "claude-code",
            displayName: "Claude Code",
            pluginId: "provider-claude-code",
          },
          {
            id: "claude-code-work",
            displayName: "Claude Work",
            pluginId: "provider-claude-code",
          },
          {
            id: "claude-code-foreign",
            displayName: "Foreign",
            pluginId: "unrelated",
          },
        ],
      },
      system: { usageLimits: collect },
    },
  });
  try {
    plugin(bb);
    const inventory = usageResourceListSchema.parse(
      await harness.behavior.callRpc(usageListMethod, {}),
    );
    expect(inventory.resources.map((resource) => resource.providerId)).toEqual([
      "claude-code",
      "claude-code-work",
    ]);
    const read = (provider: string) =>
      harness.behavior.callRpc(usageFetchMethod, {
        resourceId: JSON.stringify(["host", provider]),
        refresh: false,
      });
    expect(
      usageMeasurementSchema.parse(await read("claude-code-work")),
    ).toMatchObject({
      usage: { status: "ok", accountEmail: "work@example.com" },
    });
    expect(collect).toHaveBeenCalledWith({
      hostId: "host",
      providerId: "claude-code-work",
      refresh: false,
    });
    await expect(read("claude-code-foreign")).rejects.toThrow(
      "Usage resource no longer exists.",
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});
