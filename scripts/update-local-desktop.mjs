import { pathToFileURL } from "node:url";
import { updateLocalDesktop } from "./update-local-desktop.fork.mjs";

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  updateLocalDesktop(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
