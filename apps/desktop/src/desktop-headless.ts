interface IsDesktopHeadlessArgs {
  env: NodeJS.ProcessEnv;
  isPackaged: boolean;
}

export function isDesktopHeadless(args: IsDesktopHeadlessArgs): boolean {
  return args.env.BB_DESKTOP_HEADLESS === "1" && !args.isPackaged;
}
