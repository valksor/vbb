import { pathToFileURL } from "node:url";

import { installLocalVpsService } from "./install-local-vps-service.fork.mjs";

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  installLocalVpsService(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 3;
  });
}
