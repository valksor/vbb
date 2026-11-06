import { PluginCliError } from "@get-bb/plugin-sdk";

export function forkBrowserCliFailure(
  message: string,
  reopenHint: string,
): PluginCliError | null {
  if (/cancelled or timed out/u.test(message)) {
    return new PluginCliError(message, {
      code: "session_unavailable",
      hint: `${reopenHint} If the script needs longer, pass a larger \`--timeout\` (maximum 120 seconds).`,
    });
  }
  if (/stopped, expired, or worker restarted|Session expired/u.test(message)) {
    return new PluginCliError(message, {
      code: "session_unavailable",
      hint: reopenHint,
    });
  }
  return null;
}
