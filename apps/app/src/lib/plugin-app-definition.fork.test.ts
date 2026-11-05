import { describe, expect, it } from "vitest";
import type { PluginAppSlots } from "@get-bb/plugin-sdk";
import type { LegacyThreadHeaderActionRegistration } from "@get-bb/plugin-sdk/internal/plugin-app-collector";
import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "./plugin-app-definition";

function Component() {
  return null;
}

interface LegacyHeaderActionSlots {
  experimental_threadHeaderAction(
    registration: LegacyThreadHeaderActionRegistration,
  ): void;
}

function legacySlots(slots: PluginAppSlots): LegacyHeaderActionSlots {
  return slots as unknown as LegacyHeaderActionSlots;
}

describe("collectPluginAppRegistrations — experimental_composerAside", () => {
  it("collects a composer aside", () => {
    const definition = definePluginApp((app) => {
      app.slots.experimental_composerAside({
        id: "checks",
        title: "PR checks",
        component: Component,
      });
    });
    expect(collectPluginAppRegistrations(definition).composerAsides).toEqual([
      { id: "checks", title: "PR checks", component: Component },
    ]);
  });

  it("rejects two composer asides with the same id", () => {
    const definition = definePluginApp((app) => {
      app.slots.experimental_composerAside({
        id: "checks",
        title: "One",
        component: Component,
      });
      app.slots.experimental_composerAside({
        id: "checks",
        title: "Two",
        component: Component,
      });
    });
    expect(() => collectPluginAppRegistrations(definition)).toThrow(/checks/);
  });

  it("keeps ids independent from the thread-header slot", () => {
    const definition = definePluginApp((app) => {
      legacySlots(app.slots).experimental_threadHeaderAction({
        id: "shared",
        title: "Header",
        component: Component,
      });
      app.slots.experimental_composerAside({
        id: "shared",
        title: "Aside",
        component: Component,
      });
    });
    const collected = collectPluginAppRegistrations(definition);
    expect(collected.threadHeaderActions).toHaveLength(1);
    expect(collected.composerAsides).toHaveLength(1);
  });

  it("rejects a missing title", () => {
    const definition = definePluginApp((app) => {
      app.slots.experimental_composerAside({
        id: "checks",
        component: Component,
      } as never);
    });
    expect(() => collectPluginAppRegistrations(definition)).toThrow(/title/);
  });
});
