import { existsSync } from "node:fs";
import { join } from "node:path";

export const FORK_CURRENT_BRIDGE_LANE_FILE =
  "bridge→runtime.current.fork.ndjson";

export function resolveCurrentBridgeLanePath(
  dir: string,
  upstreamLaneFile: string,
): string {
  const forkFile = join(dir, FORK_CURRENT_BRIDGE_LANE_FILE);
  return existsSync(forkFile) ? forkFile : join(dir, upstreamLaneFile);
}
