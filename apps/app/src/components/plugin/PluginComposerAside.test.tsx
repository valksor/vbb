// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { resetPluginSlotStoreForTest } from "@/lib/plugin-slots";
import { registerPluginSlotsForTest } from "@/test/fixtures/plugins.fork";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";
import { PluginComposerAside } from "./PluginComposerAside";

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  observed = new Set<Element>();
  callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.add(target);
  }

  unobserve(target: Element): void {
    this.observed.delete(target);
  }

  disconnect(): void {
    this.observed.clear();
  }

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const originalResizeObserver = window.ResizeObserver;

beforeEach(() => {
  MockResizeObserver.instances = [];
  window.ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  window.ResizeObserver = originalResizeObserver;
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
});

function mountAside(threadId: string, projectId: string) {
  return render(
    <MemoryRouter>
      <PluginComposerAside threadId={threadId} projectId={projectId} />
    </MemoryRouter>,
  );
}

describe("PluginComposerAside", () => {
  it("renders one labelled region for a slot", async () => {
    registerPluginSlotsForTest("aside", {
      composerAsides: [
        {
          id: "checks",
          title: "PR checks",
          component: ({ threadId, projectId }) => (
            <div>
              {threadId}/{projectId}
            </div>
          ),
        },
      ],
    });
    const { container } = mountAside("thr_1", "proj_1");
    await act(async () => {});

    const regions = container.querySelectorAll('[role="region"]');
    expect(regions).toHaveLength(1);
    expect(screen.getByRole("region", { name: "PR checks" }).textContent).toBe(
      "thr_1/proj_1",
    );
    expect(regions[0]!.hasAttribute("hidden")).toBe(false);
  });

  it("mounts one copy per thread and a crash removes only that pane's copy", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    registerPluginSlotsForTest("aside", {
      composerAsides: [
        {
          id: "checks",
          title: "PR checks",
          component: ({ threadId }) => {
            if (threadId === "thr_a") throw new Error("aside crashed");
            return <div>aside for {threadId}</div>;
          },
        },
      ],
    });
    const paneA = mountAside("thr_a", "proj_1");
    const paneB = mountAside("thr_b", "proj_1");
    await act(async () => {});

    expect(paneA.container.querySelector('[role="region"]')).toBeNull();
    expect(screen.getByRole("region", { name: "PR checks" }).textContent).toBe(
      "aside for thr_b",
    );
    paneA.unmount();
    paneB.unmount();
  });

  it("hides the region while the output has no element child", async () => {
    registerPluginSlotsForTest("aside", {
      composerAsides: [
        { id: "checks", title: "PR checks", component: () => null },
      ],
    });
    const { container } = mountAside("thr_1", "proj_1");
    await act(async () => {});

    const region = container.querySelector('[role="region"]');
    expect(region).not.toBeNull();
    expect(region!.hasAttribute("hidden")).toBe(true);
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("counts text-only output as empty and unhides when an element arrives", async () => {
    let renderElement = false;
    function Harness() {
      const [, setVersion] = useState(0);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              renderElement = true;
              setVersion((version) => version + 1);
            }}
          >
            reveal
          </button>
          <PluginComposerAside threadId="thr_1" projectId="proj_1" />
        </>
      );
    }
    registerPluginSlotsForTest("aside", {
      composerAsides: [
        {
          id: "checks",
          title: "PR checks",
          component: () =>
            renderElement ? <div>aside body</div> : "text only",
        },
      ],
    });
    const { container } = render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    );
    await act(async () => {});
    expect(
      container.querySelector('[role="region"]')!.hasAttribute("hidden"),
    ).toBe(true);
    expect(screen.queryByRole("region")).toBeNull();

    await act(async () => {
      screen.getByRole("button", { name: "reveal" }).click();
    });
    await act(async () => {});

    const region = container.querySelector('[role="region"]');
    expect(region!.hasAttribute("hidden")).toBe(false);
    expect(screen.getByRole("region", { name: "PR checks" }).textContent).toBe(
      "aside body",
    );
  });

  it("adds a tab stop only while the content overflows", async () => {
    registerPluginSlotsForTest("aside", {
      composerAsides: [
        {
          id: "checks",
          title: "PR checks",
          component: () => <div>aside body</div>,
        },
      ],
    });
    const { container } = mountAside("thr_1", "proj_1");
    await act(async () => {});

    const region = container.querySelector<HTMLElement>('[role="region"]')!;
    expect(region.hasAttribute("tabindex")).toBe(false);

    const resizeObserver = MockResizeObserver.instances.at(-1)!;
    expect(resizeObserver.observed.has(region)).toBe(true);

    const sizes = { clientHeight: 100, scrollHeight: 200 };
    Object.defineProperty(region, "clientHeight", {
      get: () => sizes.clientHeight,
      configurable: true,
    });
    Object.defineProperty(region, "scrollHeight", {
      get: () => sizes.scrollHeight,
      configurable: true,
    });
    await act(async () => {
      resizeObserver.trigger();
    });
    expect(region.getAttribute("tabindex")).toBe("0");

    sizes.scrollHeight = 100;
    await act(async () => {
      resizeObserver.trigger();
    });
    expect(region.hasAttribute("tabindex")).toBe(false);
  });
});
