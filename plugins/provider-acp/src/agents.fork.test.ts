import { describe, expect, it } from "vitest";
import { customAcpAgentDefinition, parseCustomAcpAgents } from "./agents.js";
import { KNOWN_ACP_AGENTS, RESERVED_ACP_PROVIDER_IDS } from "./known-agents.js";

const reserved = RESERVED_ACP_PROVIDER_IDS;

describe("parseCustomAcpAgents", () => {
  it.each([
    "Sparkles",
    "provider-acp/claude",
    "provider-acp/glm",
    "/opt/icons/amp.svg",
    "~/icons/amp.png",
    "data:image/webp;base64,UklGRg==",
  ])("accepts the configured icon %s", (icon) => {
    const parsed = parseCustomAcpAgents({
      entries: [{ id: "amp", displayName: "Amp", command: "amp", icon }],
      reservedProviderIds: reserved,
    });

    expect(parsed.problems).toEqual([]);
    const [agent] = parsed.agents;
    if (agent === undefined) throw new Error("expected the agent to parse");
    expect(agent.icon).toBe(icon);
    expect(customAcpAgentDefinition(agent).icon).toBe(icon);
  });

  it.each([
    "./icons/unknown.svg",
    "icons/agent.svg",
    "/tmp/agent.gif",
    "https://example.com/icon.svg",
    "data:image/gif;base64,R0lGOD==",
    "other-plugin/claude",
    "provider-acp/unknown",
  ])("rejects unsupported icon %s before registration", (icon) => {
    const parsed = parseCustomAcpAgents({
      entries: [{ id: "amp", displayName: "Amp", command: "amp", icon }],
      reservedProviderIds: reserved,
    });

    expect(parsed.agents).toEqual([]);
    expect(parsed.problems[0]).toContain("Icon must be a host glyph");
  });
});

describe("customAcpAgentDefinition", () => {
  it("keeps a shipped icon when replacing an installed-only agent", () => {
    const shipped = KNOWN_ACP_AGENTS.find(
      (agent) => agent.id === "acp-opencode",
    );
    if (shipped === undefined) throw new Error("expected shipped opencode");
    const [agent] = parseCustomAcpAgents({
      entries: [{ id: "opencode", displayName: "Mine", command: "mine" }],
      reservedProviderIds: reserved,
    }).agents;
    if (agent === undefined) throw new Error("expected the agent to parse");

    const definition = customAcpAgentDefinition(agent, shipped);
    expect(definition.icon).toBe(shipped.icon);
    expect(definition.iconTint).toEqual(shipped.iconTint);
    expect(
      customAcpAgentDefinition(
        { ...agent, icon: "provider-acp/claude" },
        shipped,
      ).iconTint,
    ).toBeUndefined();
  });
});
