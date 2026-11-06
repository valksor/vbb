// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import type { ProjectSource } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import type { SystemEnvironmentProvider } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvironmentPickerUI } from "./EnvironmentPicker";

const checkoutProvider: SystemEnvironmentProvider = {
  machineProviderId: null,
  id: "project-checkout",
  displayName: "Project checkout",
  description: "Work in this project checkout.",
  icon: "Laptop",
  logoUrl: null,
  pluginId: "environment-project-checkout",
  acceptsEmptyInputs: true,
  machineAvailability: {},
  availability: null,
  requires: {
    projectCheckout: true,
    gitCheckout: false,
    gitRemote: false,
    projectless: false,
  },
  inputs: null,
};

const host = makeHost({
  id: "host_test",
  name: "Local host",
});

const sources: readonly ProjectSource[] = [
  {
    id: "src_test",
    projectId: "proj_test",
    type: "local_path",
    hostId: host.id,
    path: "/tmp/project",
    isDefault: true,
    createdAt: 0,
    updatedAt: 0,
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPicker(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("EnvironmentPickerUI", () => {
  it("separates checkout promotion from an explicit project checkout", () => {
    const onSelectProjectDefault = vi.fn();
    const onSelectProvider = vi.fn();
    renderPicker(
      <EnvironmentPickerUI
        value="project-default"
        sources={sources}
        host={host}
        isLocal
        providers={[checkoutProvider]}
        onSelectProjectDefault={onSelectProjectDefault}
        onSelectProvider={onSelectProvider}
        modal={false}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Environment" });
    expect(trigger.textContent).toContain("Checkout, then worktree");
    fireEvent.click(trigger);

    const projectDefault = screen.getByRole("option", {
      name: /Checkout, then worktree/u,
    });
    expect(projectDefault.getAttribute("aria-current")).toBe("true");
    expect(
      screen
        .getByRole("option", { name: /Project checkout/u })
        .getAttribute("aria-current"),
    ).toBeNull();

    fireEvent.click(screen.getByRole("option", { name: /Project checkout/u }));
    expect(onSelectProvider).toHaveBeenCalledWith(checkoutProvider, host.id);

    fireEvent.click(trigger);
    fireEvent.click(
      screen.getByRole("option", { name: /Checkout, then worktree/u }),
    );
    expect(onSelectProjectDefault).toHaveBeenCalledOnce();
  });

  it("selects branch promotion without selecting the worktree default", () => {
    const select = vi.fn();
    render(
      <EnvironmentPickerUI
        value="project-default:branch"
        sources={sources}
        host={host}
        isLocal
        providers={[checkoutProvider]}
        onSelectProjectDefault={select}
        modal={false}
      />,
    );
    const trigger = screen.getByRole("button", {
      name: /^Environment(?:$|:)/u,
    });
    expect(trigger.textContent).toContain("Checkout, then branch");
    fireEvent.click(trigger, { button: 0 });
    const branch = screen.getByRole("option", {
      name: /Checkout, then branch/u,
    });
    expect(branch.getAttribute("aria-current")).toBe("true");
    expect(
      screen
        .getByRole("option", { name: /Checkout, then worktree/u })
        .getAttribute("aria-current"),
    ).toBeNull();
    fireEvent.click(branch);
    expect(select).toHaveBeenCalledWith("branch");
  });
});
