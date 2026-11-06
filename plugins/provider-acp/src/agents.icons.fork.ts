import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { z } from "zod";
import type { AcpAgentDefinition, CustomAcpAgent } from "./agents.js";
import { REGISTRY_ICON_AGENT_IDS } from "./registry-icons.js";

const HOST_GLYPH_PATTERN = /^[A-Z][A-Za-z0-9]*$/u;
export const CUSTOM_AGENT_DECLARED_ICON_NAMES: readonly string[] = [
  "claude",
  "cursor",
  "glm",
  "grok",
  "hermes-agent",
  "omp",
  "opencode",
  ...REGISTRY_ICON_AGENT_IDS.map((agentId) => `registry-${agentId}`),
];
const DECLARED_ICON_NAMES = new Set<string>(CUSTOM_AGENT_DECLARED_ICON_NAMES);
const ICON_MAX_BYTES = 32 * 1024;
const ICON_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
};
const ICON_DATA_URI_PATTERN =
  /^data:image\/(?:svg\+xml|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/u;

function isIconFilePath(icon: string): boolean {
  return (
    (icon.startsWith("/") || icon.startsWith("~/")) &&
    ICON_CONTENT_TYPES[extname(icon).toLowerCase()] !== undefined
  );
}

function isCustomAgentIcon(icon: string): boolean {
  return (
    HOST_GLYPH_PATTERN.test(icon) ||
    (icon.startsWith("provider-acp/") &&
      DECLARED_ICON_NAMES.has(icon.slice("provider-acp/".length))) ||
    ICON_DATA_URI_PATTERN.test(icon) ||
    isIconFilePath(icon)
  );
}

export function loadCustomAgentIcon(
  icon: string,
): { icon: string } | { problem: string } {
  if (isIconFilePath(icon)) {
    const path = icon.startsWith("~/") ? join(homedir(), icon.slice(2)) : icon;
    let bytes: Buffer;
    try {
      const { size } = statSync(path);
      if (size === 0 || size > ICON_MAX_BYTES) {
        return {
          problem: `icon file ${icon} must be 1-${ICON_MAX_BYTES} bytes`,
        };
      }
      bytes = readFileSync(path);
    } catch (error) {
      return {
        problem: `icon file ${icon} could not be read: ${String(error)}`,
      };
    }
    const contentType = ICON_CONTENT_TYPES[extname(icon).toLowerCase()];
    return {
      icon: `data:${contentType};base64,${bytes.toString("base64")}`,
    };
  }
  const encoded = ICON_DATA_URI_PATTERN.exec(icon)?.[1];
  if (encoded === undefined) {
    return { icon };
  }
  let decodedLength: number;
  try {
    decodedLength = atob(encoded).length;
  } catch {
    return { problem: "icon data URI is not valid base64" };
  }
  return decodedLength > ICON_MAX_BYTES
    ? {
        problem: `icon data URI must decode to at most ${ICON_MAX_BYTES} bytes`,
      }
    : { icon };
}

export const customAgentIconSchema = z
  .string()
  .refine(
    isCustomAgentIcon,
    "Icon must be a host glyph, a declared ACP provider icon, an absolute or ~/ path to an .svg, .png or .webp file, or a base64 image data URI.",
  );

export function resolveCustomAgentIcon(
  agent: { icon?: string | undefined },
  shipped: AcpAgentDefinition | undefined,
  defaultIcon: string,
): Pick<AcpAgentDefinition, "icon" | "iconTint"> {
  const icon = agent.icon ?? shipped?.icon ?? defaultIcon;
  return {
    icon,
    ...(icon === shipped?.icon && shipped.iconTint !== undefined
      ? { iconTint: { ...shipped.iconTint } }
      : {}),
  };
}

export function withLoadedIcon(
  agent: CustomAcpAgent,
  warnings: string[],
): CustomAcpAgent {
  if (agent.icon === undefined) {
    return agent;
  }
  const loaded = loadCustomAgentIcon(agent.icon);
  if ("icon" in loaded) {
    return { ...agent, icon: loaded.icon };
  }
  warnings.push(
    `ACP custom agent setting: agent "${agent.id}" ${loaded.problem}; using its default icon`,
  );
  const { icon: _icon, ...withoutIcon } = agent;
  return withoutIcon;
}
