// @vitest-environment jsdom

import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider as JotaiProvider, createStore } from "jotai";
import { createElement } from "react";
import { BbHttpError } from "@bb/sdk/browser";
import { defaultUiPreferences } from "@bb/domain";
import type { UiPreferencesResponse } from "@bb/server-contract";
import { uiPreferencesQueryOptions } from "@/hooks/queries/system-queries";
import { afterEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "bb.composer-quick-replies.1";
const queryClients = new Set<QueryClient>();

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  set: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/sdk", async () => {
  const actual = await import("@bb/sdk/browser");
  return {
    BbHttpError: actual.BbHttpError,
    sdk: {
      system: {
        uiPreferences: {
          list: mocks.list,
          set: mocks.set,
        },
      },
    },
  };
});

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { error: mocks.toastError },
}));

function responseWithQuickReplies(
  value: string[],
  revision: number,
): UiPreferencesResponse {
  const preferences = Object.fromEntries(
    Object.entries(defaultUiPreferences).map(([key, defaultValue]) => [
      key,
      { revision: 1, value: defaultValue },
    ]),
  ) as UiPreferencesResponse["preferences"];
  preferences["composer.quickReplies"] = { revision, value };
  return { preferences };
}

async function renderSyncedQuickReplies(
  response: UiPreferencesResponse,
): Promise<{
  queryClient: QueryClient;
  quickRepliesAtom: typeof import("./quick-replies-preference").quickRepliesAtom;
  store: ReturnType<typeof createStore>;
  waitForUiPreferenceWrites: () => Promise<void>;
}> {
  const queryClient = new QueryClient();
  queryClients.add(queryClient);
  const store = createStore();
  const { quickRepliesAtom } = await import("./quick-replies-preference");
  const { startUiPreferencesSync, waitForUiPreferenceWrites } =
    await import("@/lib/ui-preferences/ui-preferences-sync");
  const { QuickRepliesSetting } =
    await import("@/components/settings/QuickRepliesSetting");
  store.set(
    quickRepliesAtom,
    response.preferences["composer.quickReplies"].value,
  );
  queryClient.setQueryData(uiPreferencesQueryOptions().queryKey, response);
  startUiPreferencesSync({ queryClient, store });
  render(
    createElement(JotaiProvider, { store }, createElement(QuickRepliesSetting)),
  );
  return { queryClient, quickRepliesAtom, store, waitForUiPreferenceWrites };
}

afterEach(async () => {
  const { resetUiPreferencesSyncForTest } =
    await import("@/lib/ui-preferences/ui-preferences-sync");
  resetUiPreferencesSyncForTest();
  cleanup();
  for (const queryClient of queryClients) queryClient.clear();
  queryClients.clear();
  window.localStorage.clear();
  mocks.list.mockReset();
  mocks.set.mockReset();
  mocks.toastError.mockReset();
  vi.resetModules();
});

describe("quickRepliesAtom", () => {
  it("restores configured and empty cached lists", async () => {
    for (const value of [[], ["a", "b"]]) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      const { quickRepliesAtom } = await import("./quick-replies-preference");
      expect(createStore().get(quickRepliesAtom)).toStrictEqual(value);
      vi.resetModules();
    }
  });

  it("uses an empty list for missing or malformed cache entries", async () => {
    for (const cached of [undefined, "not JSON", JSON.stringify([""])]) {
      if (cached !== undefined)
        window.localStorage.setItem(STORAGE_KEY, cached);
      const { quickRepliesAtom } = await import("./quick-replies-preference");
      expect(createStore().get(quickRepliesAtom)).toStrictEqual([]);
      window.localStorage.clear();
      vi.resetModules();
    }
  });

  it("reconciles a registered atom from the server and keeps its mirror after a failed sync", async () => {
    const queryClient = new QueryClient();
    const store = createStore();
    const { quickRepliesAtom } = await import("./quick-replies-preference");
    const {
      reconcileUiPreferences,
      startUiPreferencesSync,
      waitForUiPreferenceWrites,
    } = await import("@/lib/ui-preferences/ui-preferences-sync");
    const response = {
      preferences: Object.fromEntries(
        Object.entries(defaultUiPreferences).map(([key, value]) => [
          key,
          { revision: 1, value },
        ]),
      ),
    } as UiPreferencesResponse;
    response.preferences["composer.quickReplies"] = {
      revision: 2,
      value: ["from server"],
    };
    queryClient.setQueryData(uiPreferencesQueryOptions().queryKey, response);
    startUiPreferencesSync({ queryClient, store });

    reconcileUiPreferences(response);
    expect(store.get(quickRepliesAtom)).toStrictEqual(["from server"]);
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"),
    ).toEqual(["from server"]);

    mocks.set.mockRejectedValueOnce(new Error("offline"));
    store.set(quickRepliesAtom, ["kept locally"]);
    await waitForUiPreferenceWrites();

    expect(mocks.set).toHaveBeenCalledWith({
      expectedRevision: 2,
      key: "composer.quickReplies",
      value: ["kept locally"],
    });
    expect(store.get(quickRepliesAtom)).toStrictEqual(["kept locally"]);
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"),
    ).toEqual(["kept locally"]);
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Couldn’t sync UI preferences",
      { description: "offline" },
    );
    queryClient.clear();
  });

  it("writes an editor save when the server still has its edit base", async () => {
    const { quickRepliesAtom, store, waitForUiPreferenceWrites } =
      await renderSyncedQuickReplies(responseWithQuickReplies(["A"], 1));
    mocks.set.mockResolvedValueOnce({
      key: "composer.quickReplies",
      revision: 2,
      value: ["local A"],
    });

    const row = screen.getByLabelText("Quick reply 1");
    fireEvent.focus(row);
    fireEvent.change(row, { target: { value: "local A" } });
    fireEvent.blur(row);
    await waitForUiPreferenceWrites();

    expect(mocks.set).toHaveBeenCalledOnce();
    expect(mocks.set).toHaveBeenCalledWith({
      expectedRevision: 1,
      key: "composer.quickReplies",
      value: ["local A"],
    });
    expect(store.get(quickRepliesAtom)).toStrictEqual(["local A"]);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("does not retry an editor replacement after a 409 refetch", async () => {
    const response = responseWithQuickReplies(["A"], 1);
    const remoteResponse = responseWithQuickReplies(["A", "remote B"], 2);
    const { queryClient, quickRepliesAtom, store, waitForUiPreferenceWrites } =
      await renderSyncedQuickReplies(response);
    mocks.set.mockRejectedValueOnce(
      new BbHttpError({
        body: null,
        code: "ui_preference_conflict",
        message: "UI preference changed on another client",
        status: 409,
      }),
    );
    mocks.list.mockResolvedValueOnce(remoteResponse);

    const row = screen.getByLabelText("Quick reply 1");
    fireEvent.focus(row);
    fireEvent.change(row, { target: { value: "local A" } });
    fireEvent.blur(row);
    await waitForUiPreferenceWrites();

    expect(mocks.set).toHaveBeenCalledOnce();
    expect(mocks.set).toHaveBeenCalledWith({
      expectedRevision: 1,
      key: "composer.quickReplies",
      value: ["local A"],
    });
    expect(mocks.list).toHaveBeenCalledOnce();
    expect(store.get(quickRepliesAtom)).toStrictEqual(["local A"]);
    expect(
      queryClient.getQueryData<UiPreferencesResponse>(
        uiPreferencesQueryOptions().queryKey,
      )?.preferences["composer.quickReplies"],
    ).toStrictEqual({ revision: 2, value: ["A", "remote B"] });
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Couldn’t sync UI preferences",
      {
        description:
          "Quick replies changed in another window. Reload saved replies before saving your edits.",
      },
    );
  });
});
