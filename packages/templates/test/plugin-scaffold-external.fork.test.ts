import { describe, expect, it } from "vitest";
import { createExternalScaffoldNpmEnvironment } from "./plugin-scaffold-external.fork.js";

describe("createExternalScaffoldNpmEnvironment", () => {
  it.each(["npm_config_allow_scripts", "NPM_CONFIG_ALLOW_SCRIPTS"])(
    "removes %s and preserves the remaining environment",
    (allowScriptsKey) => {
      const baseEnv = {
        [allowScriptsKey]: "true",
        NPM_CONFIG_GLOBALCONFIG: "/existing/global/npmrc",
        NPM_CONFIG_USERCONFIG: "/existing/user/npmrc",
        UNRELATED_FIELD: "retained",
      };

      expect(
        createExternalScaffoldNpmEnvironment(
          baseEnv,
          "/isolated/user/npmrc",
          "/isolated/global/npmrc",
        ),
      ).toEqual({
        NPM_CONFIG_GLOBALCONFIG: "/isolated/global/npmrc",
        NPM_CONFIG_USERCONFIG: "/isolated/user/npmrc",
        UNRELATED_FIELD: "retained",
      });
      expect(baseEnv).toEqual({
        [allowScriptsKey]: "true",
        NPM_CONFIG_GLOBALCONFIG: "/existing/global/npmrc",
        NPM_CONFIG_USERCONFIG: "/existing/user/npmrc",
        UNRELATED_FIELD: "retained",
      });
    },
  );
});
