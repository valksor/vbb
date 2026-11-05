import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ClientConfig } from "@bb/config/client-config";
import {
  OPEN_IN_TARGET_RUN_COMMAND_DISABLED_ERROR_CODE,
  type OpenInTargetRequest,
  type WorkspaceOpenTarget,
} from "@bb/host-daemon-contract";
import {
  normalizeTerminalRunCommandText,
  TERMINAL_RUN_COMMAND_TEMP_DIR_PREFIX,
  WorkspaceOpenTargetError,
} from "@bb/local-open-targets";
import type { HostDaemonLogger } from "./logger.js";

const CLIENT_RUN_COMMAND_DEFAULT_ENABLED = true;
const TERMINAL_RUN_COMMAND_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface RunCommandConfigLoader {
  load(): Promise<ClientConfig>;
}

interface CreateRunCommandGateArgs {
  configLoader: RunCommandConfigLoader;
  logger?: HostDaemonLogger;
}

interface RunCommandDisabledBody {
  code: typeof OPEN_IN_TARGET_RUN_COMMAND_DISABLED_ERROR_CODE;
  message: string;
}

async function resolveRunCommandEnabled(
  configLoader: RunCommandConfigLoader,
): Promise<boolean> {
  try {
    return (
      (await configLoader.load()).runCommandEnabled ??
      CLIENT_RUN_COMMAND_DEFAULT_ENABLED
    );
  } catch {
    return false;
  }
}

function withoutRunCommandCapability(
  target: WorkspaceOpenTarget,
): WorkspaceOpenTarget {
  const capabilities = { ...target.capabilities };
  delete capabilities.runCommand;
  return { ...target, capabilities };
}

export async function removeStaleTerminalRunCommandDirs(args: {
  now?: number;
  tmpDir: string;
}): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(args.tmpDir, { withFileTypes: true });
  } catch {
    return;
  }
  const now = args.now ?? Date.now();
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      !entry.name.startsWith(TERMINAL_RUN_COMMAND_TEMP_DIR_PREFIX)
    ) {
      continue;
    }
    const dirPath = path.join(args.tmpDir, entry.name);
    try {
      const stats = await fs.stat(dirPath);
      if (now - stats.mtimeMs > TERMINAL_RUN_COMMAND_MAX_AGE_MS) {
        await fs.rm(dirPath, { force: true, recursive: true });
      }
    } catch {}
  }
}

export function startRunCommandMaintenance(): void {
  void removeStaleTerminalRunCommandDirs({ tmpDir: os.tmpdir() });
}

export function assertNoRemoteRunCommand(request: OpenInTargetRequest): void {
  if (request.command !== undefined) {
    throw new WorkspaceOpenTargetError({
      code: "remote_target_unsupported",
      message: `${request.targetId} cannot run commands on remote SSH paths`,
    });
  }
}

export function createRunCommandGate(args: CreateRunCommandGateArgs): {
  admit(
    request: OpenInTargetRequest,
    origin: string | null,
  ): Promise<RunCommandDisabledBody | null>;
  filterTargets(targets: WorkspaceOpenTarget[]): Promise<WorkspaceOpenTarget[]>;
} {
  const logger = args.logger ?? null;
  return {
    async admit(request, origin) {
      if (request.command === undefined) {
        return null;
      }
      if (!(await resolveRunCommandEnabled(args.configLoader))) {
        return {
          code: OPEN_IN_TARGET_RUN_COMMAND_DISABLED_ERROR_CODE,
          message:
            "Running commands in the terminal is disabled by runCommandEnabled in the daemon client config.",
        };
      }
      logger?.info(
        {
          origin,
          scriptSha256: createHash("sha256")
            .update(normalizeTerminalRunCommandText(request.command), "utf8")
            .digest("hex"),
          targetId: request.targetId,
        },
        "Open in target command run",
      );
      return null;
    },
    async filterTargets(targets) {
      return (await resolveRunCommandEnabled(args.configLoader))
        ? targets
        : targets.map(withoutRunCommandCapability);
    },
  };
}
