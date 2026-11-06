import { createPackagedAppLaunchArguments } from "../scripts/packaged-app-launch.mjs";

export function smokeLaunchArguments(userDataDir: string): string[] {
  return [
    ...createPackagedAppLaunchArguments({
      platform: process.platform,
      userDataDir,
    }),
    ...(process.platform === "darwin" ? ["--use-mock-keychain"] : []),
  ];
}

export function createSmokeEnv(args: { dataDir: string }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BB_DATA_DIR: args.dataDir,
    BB_DESKTOP_AUTO_UPDATE: "0",
    BB_DESKTOP_HEADLESS: "1",
    BB_DESKTOP_OPEN_DEVTOOLS: "0",
    BB_DESKTOP_VERSION_CHECK: "0",
  };
  delete env.BB_DESKTOP_APP_URL;
  delete env.BB_DESKTOP_NODE_EXEC_PATH;
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
