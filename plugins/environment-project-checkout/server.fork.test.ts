import type {
  PluginEnvironmentProviderCreateContext,
  PluginEnvironmentProviderRestoreContext,
  PluginEnvironmentProviderValidateContext,
} from "@get-bb/plugin-sdk/environment-provider";
import {
  createFakePluginHost,
  makeHostResponse,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { expect, it, vi } from "vitest";
import { PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID } from "./provider-id.js";
import plugin from "./server.js";

type Environment =
  PluginEnvironmentProviderRestoreContext["previous"]["environment"];
type ThreadRow = { id: string; environmentId: string | null; status: string };

const HOST = makeHostResponse({ id: "host-a", name: "Fake machine" });
const PROJECT: PluginEnvironmentProviderCreateContext["project"] = {
  id: "project-1",
  kind: "standard",
  name: "bb",
  gitRemoteUrl: null,
  createdAt: 1,
  updatedAt: 1,
};
const CHECKOUT_PATH = "/checkouts/bb";

function environmentAt(path: string): Environment {
  return {
    id: "env_1",
    name: null,
    projectId: PROJECT.id,
    hostId: HOST.id,
    path,
    isGitRepo: true,
    branchName: "main",
    baseBranch: null,
    mergeBaseBranch: null,
    status: "ready",
    environmentProviderId: PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID,
    environmentProviderInstanceKey: null,
    environmentProviderSelection: null,
    createdAt: 1,
    updatedAt: 1,
  } as Environment;
}

async function validateWith(args: {
  environments: Environment[];
  threads: ThreadRow[];
  inputs: PluginEnvironmentProviderValidateContext["inputs"];
  inspectCheckout?: () => unknown;
}) {
  const { bb, harness } = createFakePluginHost({
    pluginId: "environment-project-checkout",
    experimental_callHostRpc: (call) => {
      if (call.method === "inspectCheckout" && args.inspectCheckout) {
        return args.inspectCheckout();
      }
      throw new Error(`unexpected host call ${call.method}`);
    },
    sdk: {
      environments: {
        list: (filters?: { hostId?: string; path?: string }) =>
          args.environments.filter(
            (row) =>
              (filters?.hostId === undefined ||
                row.hostId === filters.hostId) &&
              (filters?.path === undefined || row.path === filters.path),
          ),
      },
      threads: {
        list: (filters?: { environmentId?: string }) =>
          args.threads.filter(
            (row) =>
              filters?.environmentId === undefined ||
              row.environmentId === filters.environmentId,
          ),
      },
    },
  });
  await plugin(bb);
  const provider = harness.registrations.environmentProviders.get(
    PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID,
  );
  if (provider === undefined || provider.validate === null) {
    throw new Error("the checkout provider registered no validate");
  }
  return provider.validate({
    project: PROJECT,
    host: HOST,
    projectCheckout: { experimental_ownsPath: false, path: CHECKOUT_PATH },
    gitRemote: null,
    inputs: args.inputs,
  });
}

it("reserves promotion input for the internal workflow", async () => {
  expect(
    await validateWith({
      environments: [],
      threads: [],
      inputs: {
        promotion: {
          action: "enter",
          intent: {
            operationId: "promotion",
            path: CHECKOUT_PATH,
            sourceBranch: "main",
            sourceHead: "a".repeat(40),
            target: { kind: "new", name: "feature" },
          },
        },
      },
    }),
  ).toMatchObject({
    action: "refuse",
    message: expect.stringContaining("reserved"),
  });
});

it.each([
  "completed",
  "uncertain",
  "failed",
  "claim-refused",
  "transport",
  "live-enter",
  "live-inspect",
] as const)(
  "handles internal promotion %s without normal attach",
  async (mode) => {
    const intent = {
      operationId: "promotion",
      path: CHECKOUT_PATH,
      sourceBranch: "main",
      sourceHead: "a".repeat(40),
      target: { kind: "new", name: "feature" },
    };
    const claim = vi.fn(async () => mode !== "claim-refused");
    const resultSnapshot = {
      operationId: "promotion",
      phase:
        mode === "completed"
          ? "completed"
          : mode === "uncertain"
            ? "uncertain"
            : "failed",
      branchName: "main",
      headSha: "a".repeat(40),
      observation: "observed",
      commandTerminated: true,
      resolution: null,
      message: null,
      replayed: false,
    };
    const hostCall = vi.fn((call: { method: string; input: unknown }) => {
      expect(claim).toHaveBeenCalledWith(CHECKOUT_PATH);
      expect(call.method).toBe("promoteBranch");
      if (mode === "transport") throw new Error("offline");
      return resultSnapshot;
    });
    const live = mode === "live-enter" || mode === "live-inspect";
    const { bb, harness } = createFakePluginHost({
      pluginId: "environment-project-checkout",
      experimental_callHostRpc: hostCall,
      sdk: {
        environments: {
          list: () => (live ? [environmentAt(CHECKOUT_PATH)] : []),
        },
        threads: {
          list: () => (live ? [{ id: "other", status: "active" }] : []),
        },
      },
    });
    try {
      await plugin(bb);
      const provider = harness.registrations.environmentProviders.get(
        PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID,
      );
      if (!provider) throw new Error("Missing provider");
      const result = await provider.create({
        project: PROJECT,
        host: HOST,
        projectCheckout: { path: CHECKOUT_PATH, experimental_ownsPath: true },
        gitRemote: null,
        inputs: {
          promotion: {
            action: mode === "live-inspect" ? "inspect" : "enter",
            intent,
          },
        },
        thread: makeThreadResponse(),
        suggestedBranchName: "ignored",
        attempt: 1,
        pathKey: "promotion",
        experimental_claimPath: claim,
        report: { step() {}, log() {} },
        signal: new AbortController().signal,
      });
      if (mode === "claim-refused") {
        expect(result.status).toBe("failed");
        expect(hostCall).not.toHaveBeenCalled();
      } else if (mode === "transport")
        expect(result).toMatchObject({ status: "failed", message: "offline" });
      else {
        expect(result).toMatchObject({
          status: "created",
          path: CHECKOUT_PATH,
          ownsPath: false,
          resource: { phase: resultSnapshot.phase },
        });
        if (live)
          expect(hostCall.mock.calls[0]?.[0].input).toMatchObject({
            action: "inspect",
          });
      }
    } finally {
      await harness.lifecycle.dispose();
    }
  },
);
