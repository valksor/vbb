import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import anatomy from "../src/anatomy-manifest.json";
import {
  AppShellWireframe,
  SurfaceMapContext,
  type SurfaceMapState,
} from "../src/wireframes";

const mapState: SurfaceMapState = {
  activeId: null,
  setActiveId: vi.fn(),
  expandedId: null,
  numberOf: () => 1,
};

function renderWireframe(
  node: ReactNode,
  state: SurfaceMapState = mapState,
): string {
  return renderToStaticMarkup(
    createElement(SurfaceMapContext.Provider, { value: state }, node),
  );
}

describe("guide fixture boundaries", () => {
  it("draws the composer-aside beside the composer with one badge above it", () => {
    const markup = renderWireframe(createElement(AppShellWireframe));
    const contract = anatomy.surfaceFixtures["composer-aside"];
    const composerRow = markup.slice(
      markup.indexOf('data-guide-region="pending-interaction"'),
      markup.indexOf('data-guide-region="composer-aside"'),
    );

    expect(contract.requiredStates).toEqual(["anchor"]);
    for (const label of contract.labels.anchor) {
      expect(markup).toContain(label);
    }
    for (const classAnchor of contract.fixtureClassAnchors) {
      expect(markup, `missing fixture class ${classAnchor}`).toContain(
        classAnchor,
      );
    }
    expect(composerRow).toContain('data-guide-region="pending-interaction"');
    expect(markup.match(/data-guide-region="composer-aside"/g)).toHaveLength(1);
    expect(markup).toMatch(
      /data-guide-badge="composer-aside"[\s\S]*?data-guide-badge-placement="above"/,
    );
    expect(markup.match(/data-guide-badge="composer-aside"/g)).toHaveLength(1);
    const mobileMarkup = renderWireframe(
      createElement(AppShellWireframe, {
        mobile: true,
        mobileScene: "conversation",
      }),
    );
    expect(mobileMarkup).not.toContain('data-guide-region="composer-aside"');
  });
});
