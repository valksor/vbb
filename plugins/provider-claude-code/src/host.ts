import os from "node:os";
import {
  experimental_defineHostEntry,
  experimental_nativeRootsHostContract,
} from "@get-bb/plugin-sdk/host";
import { resolveClaudeProviderNativeRoots } from "./native-roots.profile.fork.js";

export { experimental_providerBridge } from "./bridge/bridge.js";

export default experimental_defineHostEntry({
  contract: experimental_nativeRootsHostContract,
  handlers: {
    resolveNativeRoots: (input) =>
      resolveClaudeProviderNativeRoots({
        cwd: input.cwd,
        bridgeOptions: input.bridgeOptions,
        homeDir: os.homedir(),
        env: process.env,
      }),
  },
});
