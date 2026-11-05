import {
  formatClientConfigPath,
  parseClientConfig,
  type ClientConfig,
} from "@bb/config/client-config";
import { mutateClientConfig } from "./launcher.js";

const CLIENT_RUN_COMMAND_COMMAND = "run-command";

function setClientRunCommand(
  config: ClientConfig,
  runCommandEnabled: boolean,
): ClientConfig {
  return parseClientConfig({
    runCommandEnabled,
    servers: config.servers,
  });
}

export async function runForkClientCommand(
  args: { dataDir: string },
  commandArgs: string[],
): Promise<boolean> {
  if (commandArgs[0] !== CLIENT_RUN_COMMAND_COMMAND) {
    return false;
  }
  const value = commandArgs[1];
  if (commandArgs.length !== 2 || (value !== "on" && value !== "off")) {
    throw new Error("Usage: bb-app client run-command <on|off>");
  }
  await mutateClientConfig(args.dataDir, (current) =>
    setClientRunCommand(current, value === "on"),
  );
  process.stdout.write(
    `Set run-command ${value} in ${formatClientConfigPath(args.dataDir)}\n`,
  );
  return true;
}
