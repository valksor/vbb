export function createExternalScaffoldNpmEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  userConfig: string,
  globalConfig: string,
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  delete env.npm_config_allow_scripts;
  delete env.NPM_CONFIG_ALLOW_SCRIPTS;
  env.NPM_CONFIG_GLOBALCONFIG = globalConfig;
  env.NPM_CONFIG_USERCONFIG = userConfig;
  return env;
}
