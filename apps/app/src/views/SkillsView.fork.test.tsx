// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render as renderDom,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { focusManager } from "@tanstack/react-query";
import type { SkillSummary } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { sdk } from "@/lib/sdk";
import { appToast } from "@/components/ui/app-toast";
import type { RegistrySkill } from "@/lib/skills-registry";
import { SkillsLibrary } from "../components/tools/SkillsLibrary";

afterEach(() => {
  focusManager.setFocused(undefined);
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeSkill(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    id: `skill_${"a".repeat(64)}`,
    name: "code-review",
    description: "Review the current diff.",
    provider: "claude-code",
    scope: "provider-user",
    pluginId: null,
    filePath: "/home/u/.claude/skills/code-review/SKILL.md",
    manageable: true,
    registrySkillId: null,
    ...overrides,
  };
}

function makeRegistrySkill(
  overrides: Partial<RegistrySkill> = {},
): RegistrySkill {
  return {
    id: "owner/repo/useful-skill",
    source: "owner/repo",
    skillId: "useful-skill",
    name: "Useful skill",
    installs: 100,
    stars: 20,
    installUrl: null,
    url: "https://skills.sh/owner/repo/useful-skill",
    topic: "Development",
    summary: "A useful skill.",
    ...overrides,
  };
}

function requestPath(input: RequestInfo | URL): string {
  const url = new URL(String(input), window.location.origin);
  return `${url.pathname}${url.search}`;
}

function stubRegistryFetch(
  registrySkill: RegistrySkill,
  options: {
    detail?: boolean;
    list?: boolean;
    entry?: RegistrySkill;
    entryFails?: boolean;
    ranking?: "trending" | "all-time";
  } = {},
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = requestPath(input);
    if (url.startsWith("/api/v1/skills-registry?")) {
      return new Response(
        JSON.stringify({
          skills: options.list ? [registrySkill] : [],
          pagination: {
            page: 0,
            perPage: 24,
            total: options.list ? 1 : 0,
            hasMore: false,
          },
          ranking: options.ranking ?? "trending",
        }),
        { status: 200 },
      );
    }
    if (url.startsWith("/api/v1/skills-registry/entry?")) {
      if (options.entryFails) return new Response(null, { status: 404 });
      return new Response(JSON.stringify(options.entry ?? registrySkill), {
        status: 200,
      });
    }
    if (url === "/api/v1/skills-registry/entries") {
      return Response.json({
        entries: options.entryFails ? [] : [options.entry ?? registrySkill],
      });
    }
    if (
      url.startsWith("/api/v1/skills-registry/detail?") &&
      options.detail !== false
    ) {
      return new Response(
        JSON.stringify({
          id: registrySkill.id,
          source: registrySkill.source,
          skillId: registrySkill.skillId,
          hash: null,
          files: [{ path: "SKILL.md", contents: "# Useful skill" }],
        }),
        { status: 200 },
      );
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("SkillsLibrary registry detail lifecycle", () => {
  it("installs a registry skill from Browse and marks it installed once the library lists it", async () => {
    const registrySkill = makeRegistrySkill();
    let installed = false;
    vi.spyOn(sdk.skills, "list").mockImplementation(async () => ({
      skills: installed
        ? [
            makeSkill({
              name: registrySkill.skillId,
              provider: null,
              scope: "bb-user",
              registrySkillId: registrySkill.id,
              filePath: "/home/u/.bb/skills/useful-skill/SKILL.md",
            }),
          ]
        : [],
    }));
    let finishInstall: () => void = () => {};
    const install = vi.spyOn(sdk.skills.registry, "install").mockImplementation(
      () =>
        new Promise((resolve) => {
          finishInstall = () => {
            installed = true;
            resolve({
              ok: true,
              filePath: "/home/u/.bb/skills/useful-skill/SKILL.md",
            });
          };
        }),
    );
    const toastSuccess = vi.spyOn(appToast, "success");
    stubRegistryFetch(registrySkill, { list: true });
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    renderDom(
      <MemoryRouter initialEntries={["/skills"]}>
        <QueryClientWrapper>
          <Routes>
            <Route path="/skills" element={<SkillsLibrary />} />
          </Routes>
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Install Useful skill into bb",
      }),
    );
    await waitFor(() =>
      expect(install).toHaveBeenCalledWith({
        registrySkillId: registrySkill.id,
      }),
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Install Useful skill into bb" })
          .getAttribute("aria-busy"),
      ).toBe("true"),
    );

    finishInstall();

    const installedButton = await screen.findByRole("button", {
      name: "Useful skill is installed in bb",
    });
    expect(installedButton.hasAttribute("disabled")).toBe(true);
    expect(install).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Installed Useful skill"),
    );
  });
});
