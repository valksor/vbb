// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
  type PluginUpdateState,
} from "@/hooks/queries/plugin-settings-queries";
import { resetNotificationStore } from "@/lib/notifications/notification-store";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makePluginListItem } from "@/test/fixtures/plugins";
import { formatAbsoluteDate } from "./plugin-ui";
import { UpdatePluginDialog } from "./UpdatePluginDialog";

function plugin(updateState: Partial<PluginUpdateState>): PluginListItem {
  return makePluginListItem({
    id: "linear",
    source: "npm:@example/linear@^1.6.0",
    rootDir: "/plugins/linear",
    version: "1.6.2",
    name: "Linear",
    provenance: "catalog",
    catalogEntryId: "linear",
    publisherLabel: "BB Community",
    sourceDisplay: "npm · @bb-plugins/linear · tracks compatible",
    updateState: { ...EMPTY_PLUGIN_UPDATE_STATE, ...updateState },
  });
}

const queryClients: QueryClient[] = [];

function createDialogTestHarness() {
  const harness = createQueryClientTestHarness();
  queryClients.push(harness.queryClient);
  const Wrapper = harness.wrapper;
  return {
    ...harness,
    wrapper: ({ children }: { children: import("react").ReactNode }) => (
      <MemoryRouter>
        <Wrapper>{children}</Wrapper>
      </MemoryRouter>
    ),
  };
}

afterEach(async () => {
  cleanup();
  try {
    await vi.waitFor(() => {
      expect(queryClients.every((client) => client.isMutating() === 0)).toBe(
        true,
      );
    });
  } finally {
    for (const client of queryClients.splice(0)) client.clear();
    resetNotificationStore();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  }
});

describe("UpdatePluginDialog", () => {
  it("opens persisted failure details and retries an available update", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          job: {
            id: "update-1",
            pluginId: "linear",
            displayName: "Linear",
            state: "running",
            phase: "preparing",
          },
        },
        { status: 202 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onOpenChange = vi.fn();
    const { wrapper } = createDialogTestHarness();
    const failedAt = new Date(2026, 6, 22).getTime();
    render(
      <UpdatePluginDialog
        plugin={plugin({
          availableVersion: "1.8.0",
          availableLabel: "1.8.0",
          lastFailure: {
            version: "1.7.0",
            label: "1.7.0",
            at: failedAt,
            detail: "factory threw during activation",
          },
        })}
        open
        onOpenChange={onOpenChange}
      />,
      { wrapper },
    );

    expect(screen.getByRole("heading", { name: "Update failed" })).toBeTruthy();
    expect(
      screen.getByText(`Failed on ${formatAbsoluteDate(failedAt)}.`),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "bb couldn’t activate 1.7.0. It restored 1.6.2 and its data.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("factory threw during activation")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Retry update to 1.8.0" }),
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
