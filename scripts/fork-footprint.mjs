import { main } from "./fork-footprint.fork.mjs";

process.exitCode = main(process.argv.slice(2));

