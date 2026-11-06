import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfiguredAcpAgents } from "./configured-agents.js";
import { acpProviderDeclaration } from "./declaration.js";
import { KNOWN_ACP_AGENTS, RESERVED_ACP_PROVIDER_IDS } from "./known-agents.js";

const reserved = RESERVED_ACP_PROVIDER_IDS;

function onlyAgent(resolved: ReturnType<typeof resolveConfiguredAcpAgents>) {
  const [agent] = resolved.agents;
  if (agent === undefined || resolved.agents.length !== 1) {
    throw new Error(
      `expected exactly one agent, got ${resolved.agents.length}`,
    );
  }
  return agent;
}

describe("a configured entry with a custom icon file", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "bb-acp-custom-icon-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  function withIcon(icon: string) {
    return resolveConfiguredAcpAgents({
      settingValue: JSON.stringify([
        { id: "amp", displayName: "Amp", command: "amp", icon },
      ]),
      reservedProviderIds: reserved,
      shippedAgents: KNOWN_ACP_AGENTS,
    });
  }

  it("registers the file's bytes as an image data URI", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const iconPath = path.join(tempRoot, "amp.SVG");
    await writeFile(iconPath, svg);

    const resolved = withIcon(iconPath);

    expect(resolved.warnings).toEqual([]);
    expect(acpProviderDeclaration(onlyAgent(resolved)).icon).toBe(
      `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    );
  });

  it("keeps the agent with its default icon when the file cannot be used", async () => {
    const tooLarge = path.join(tempRoot, "large.png");
    await writeFile(tooLarge, Buffer.alloc(32 * 1024 + 1));

    for (const icon of [path.join(tempRoot, "missing.webp"), tooLarge]) {
      const resolved = withIcon(icon);
      expect(onlyAgent(resolved).icon).toBe("Toolbox");
      expect(resolved.warnings[0]).toContain(`icon file ${icon}`);
    }
  });

  it("passes a data URI through and refuses an oversized one", () => {
    const small = `data:image/png;base64,${Buffer.from("png").toString("base64")}`;
    expect(onlyAgent(withIcon(small)).icon).toBe(small);

    const large = withIcon(
      `data:image/png;base64,${Buffer.alloc(32 * 1024 + 1).toString("base64")}`,
    );
    expect(onlyAgent(large).icon).toBe("Toolbox");
    expect(large.warnings[0]).toContain("icon data URI must decode");

    const malformed = withIcon("data:image/png;base64,abcde");
    expect(onlyAgent(malformed).icon).toBe("Toolbox");
    expect(malformed.warnings[0]).toContain("not valid base64");
  });
});
