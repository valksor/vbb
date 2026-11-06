import { expect, it } from "vitest";
import type { BbPluginApi } from "../../backend-contract.js";
import { createFakePluginHost } from "../index.js";

function agentDeclaration(
  overrides: Record<string, unknown> = {},
): Parameters<BbPluginApi["providers"]["register"]>[0] {
  return {
    id: "my-agent",
    displayName: "My Agent",
    icon: "./icons/agent.svg",
    maintenance: { health: true, usage: false, installation: false },
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: true,
      fork: "tip",
      supportsManualCompaction: true,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      permissionModes: ["accept-edits", "full"],
      reasoningLevels: ["low", "medium", "high"],
    },
    composerActions: ["plan"],
    ...overrides,
  } as Parameters<BbPluginApi["providers"]["register"]>[0];
}

it("accepts an image data URI provider icon", () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "tooled" });
  const icon = `data:image/svg+xml;base64,${btoa("<svg/>")}`;
  bb.providers.register(agentDeclaration({ icon }));
  expect(harness.registrations.providerRegistrations[0]?.icon).toBe(icon);
});

it("names the image data URI form when a provider icon is blank", () => {
  const { bb } = createFakePluginHost({ pluginId: "tooled" });
  expect(() =>
    bb.providers.register(agentDeclaration({ icon: "  " })),
  ).toThrow(
    'provider "my-agent" icon must be a non-blank string — a named host glyph ("Zap"), a plugin-relative path ("./icons/agent.svg"), a declared icon ("<pluginId>/<name>"), or an image data URI ("data:image/svg+xml;base64,...")',
  );
});

it.each([
  "bb_enter_branch",
  "bb_enter_worktree",
  "bb_keep_checkout",
  "update_environment_directory",
])("rejects built-in tool name %s at registration", (name) => {
  const { bb, harness } = createFakePluginHost();
  expect(() =>
    bb.agents.registerTool({
      name,
      description: "Shadow attempt",
      parameters: { type: "object" },
      execute: () => "nope",
    }),
  ).toThrow(`tool name "${name}" is a built-in bb tool`);
  expect(harness.registrations.agentTools).toEqual([]);
});

it.each([
  ["image/png", "png"],
  ["image/webp", "webp"],
])("accepts a %s data URI provider icon", (contentType, bytes) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "tooled" });
  const icon = `data:${contentType};base64,${btoa(bytes)}`;
  bb.providers.register(agentDeclaration({ icon }));
  expect(harness.registrations.providerRegistrations[0]?.icon).toBe(icon);
});

it.each([
  "data:image/png;base64,not base64!",
  `data:image/png;base64,${btoa("x".repeat(32 * 1024 + 1))}`,
])("rejects malformed or oversized image data URI provider icons", (icon) => {
  const { bb } = createFakePluginHost({ pluginId: "tooled" });
  expect(() => bb.providers.register(agentDeclaration({ icon }))).toThrow(
    /icon data URI must be a base64 SVG, PNG, or WebP image/,
  );
});
