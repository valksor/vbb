import type { JsonValue } from "@bb/domain";
import type { HostDaemonOnlineRpcRequestMessage } from "@bb/host-daemon-contract";
import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import type { ExperimentalNativeRootsResolveAnswer } from "@get-bb/plugin-sdk/host";
import { describe, expect, it } from "vitest";
import { COMMAND_TIMEOUT_MS } from "../../../src/constants.js";
import { resolveProviderNativeRootSet } from "../../../src/services/providers/native-roots.js";
import type { ProviderRegistration } from "../../../src/services/providers/provider-registry.js";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
} from "../../helpers/host-rpc.js";
import { stubHostArtifact } from "../../helpers/provider-registry.js";
import { seedHostSession } from "../../helpers/seed.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const PLUGIN_ID = "provider-resolving";

function declaration(
  id: string,
  overrides: Partial<PluginProviderDeclaration> = {},
): PluginProviderDeclaration {
  return {
    id,
    displayName: id,
    maintenance: { health: false, usage: false, installation: false },
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      fork: "none",
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      permissionModes: ["full"],
      reasoningLevels: ["medium"],
    },
    composerActions: [],
    ...overrides,
  };
}

const RESOLVING = {
  pluginId: PLUGIN_ID,
  declaration: declaration("resolving", {
    experimental_nativeSkillRoots: { project: [".resolving/skills"] },
    experimental_resolvesNativeRoots: true,
  }),
};

const USER_SKILLS = {
  path: "/home/me/.resolving/skills",
  origin: "user",
  recursive: false,
  ancestors: false,
  namePrefix: "",
  shape: "skills",
} as const;

interface ResolverStub {
  calls: HostDaemonOnlineRpcRequestMessage[];
  answer: ExperimentalNativeRootsResolveAnswer | Error | { raw: JsonValue };
  holdUntil: Promise<void> | null;
}

function registerResolverHost(
  harness: TestAppHarness,
  hostId: string,
): ResolverStub {
  const { host, session } = seedHostSession(harness.deps, { id: hostId });
  const stub: ResolverStub = {
    calls: [],
    answer: { skills: [{ path: USER_SKILLS.path, origin: "user" }] },
    holdUntil: null,
  };
  const answer = (): HostRpcHandlerResult => {
    if (stub.answer instanceof Error) throw stub.answer;
    if ("raw" in stub.answer) {
      return { ok: true, result: { output: stub.answer.raw } };
    }
    return { ok: true, result: { output: stub.answer } };
  };
  registerHostRpcResponder(harness, {
    hostId: host.id,
    sessionId: session.id,
    handle: (request) => {
      if (
        request.command.type !== "plugin.host.call" ||
        request.command.method !== "resolveNativeRoots"
      ) {
        throw new Error(`Unexpected RPC ${request.command.type}`);
      }
      stub.calls.push(request);
      return stub.holdUntil === null ? answer() : stub.holdUntil.then(answer);
    },
  });
  return stub;
}

function registration(
  harness: TestAppHarness,
  id: string,
): ProviderRegistration {
  const found = harness.deps.providerRegistry.get(id);
  if (found === null) throw new Error(`provider ${id} not registered`);
  return found;
}

describe("resolveProviderNativeRootSet", () => {
  it("sends the provider's bridge options only when it has some", async () => {
    await withTestHarness(
      {
        extraProviders: [
          RESOLVING,
          {
            pluginId: PLUGIN_ID,
            declaration: declaration("resolving-profile", {
              experimental_resolvesNativeRoots: true,
              experimental_bridgeOptions: { claudeConfigDir: "~/.claude-work" },
            }),
          },
        ],
      },
      async (harness) => {
        harness.deps.pluginHostArtifacts.set(
          PLUGIN_ID,
          stubHostArtifact(PLUGIN_ID),
        );
        const stub = registerResolverHost(harness, "host-a");
        for (const id of ["resolving", "resolving-profile"]) {
          await resolveProviderNativeRootSet(harness.deps, {
            registration: registration(harness, id),
            hostId: "host-a",
            cwd: "/work/one",
            timeoutMs: COMMAND_TIMEOUT_MS,
          });
        }
        expect(stub.calls.map((call) => call.command)).toEqual([
          expect.objectContaining({
            input: { providerId: "resolving", cwd: "/work/one" },
          }),
          expect.objectContaining({
            input: {
              providerId: "resolving-profile",
              cwd: "/work/one",
              bridgeOptions: { claudeConfigDir: "~/.claude-work" },
            },
          }),
        ]);
      },
    );
  });
});
