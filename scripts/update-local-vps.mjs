import { pathToFileURL } from "node:url";

import {
  VPS_UPDATE_EXIT_CODES,
  VpsUpdateError,
  runUnderFlock,
} from "./update-local-vps.fork.mjs";

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runUnderFlock(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode =
      error instanceof VpsUpdateError
        ? error.exitCode
        : VPS_UPDATE_EXIT_CODES.usage;
  });
}
