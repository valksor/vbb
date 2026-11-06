// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import { SecondaryPanelSelectionActions } from "./SecondaryPanelSelectionActions";

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  cleanup();
});

it.each([
  ["inline", "**Run** `pnpm build` now.", "**Run** pnpm build now."],
  ["fenced", "Run it:\n\n```ts\nconst x = 1;\n```", "Run it:\n\nconst x = 1;"],
])(
  "copies secondary-panel %s code without Markdown code wrappers",
  async (_kind, content, expected) => {
    const { container } = render(
      <SecondaryPanelSelectionActions markdown>
        <MarkdownPreview content={content} />
      </SecondaryPanelSelectionActions>,
    );
    await waitFor(() => {
      expect(container.querySelector("code")).not.toBeNull();
    });
    const range = document.createRange();
    range.selectNodeContents(container.firstElementChild!);
    window.getSelection()!.addRange(range);
    const data = new Map<string, string>();
    const accepted = fireEvent.copy(document, {
      clipboardData: {
        setData: (type: string, value: string) => data.set(type, value),
      },
    });
    expect(accepted).toBe(false);
    expect(data.get("text/plain")).toBe(expected);
    expect(data.get("text/html")).toContain("<code");
  },
);
