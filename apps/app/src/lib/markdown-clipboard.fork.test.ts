// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectionClipboard } from "./markdown-clipboard";
import { isBareCode, selectionClipboardBare } from "./markdown-clipboard.fork";

let root: HTMLDivElement;
let selected: Range;

beforeEach(() => {
  root = document.createElement("div");
  root.innerHTML =
    '<p>Intro</p><pre><code class="language-ts">const answer = 1;\n</code></pre>';
  document.body.appendChild(root);
  selected = document.createRange();
  selected.selectNodeContents(root);
});

afterEach(() => {
  vi.restoreAllMocks();
  root.remove();
});

describe("selectionClipboardBare", () => {
  it("copies a code block without a fence", () => {
    const { text } = selectionClipboardBare(selected, root, "markdown");

    expect(text).toContain("const answer = 1;");
    expect(text).not.toContain("```");
  });

  it("leaves the next normal copy fenced", () => {
    selectionClipboardBare(selected, root, "markdown");

    expect(isBareCode()).toBe(false);
    expect(selectionClipboard(selected, root, "markdown").text).toContain(
      "```ts\nconst answer = 1;\n```",
    );
  });

  it("leaves the next normal copy fenced when the serializer throws", () => {
    vi.spyOn(Range.prototype, "cloneContents").mockImplementationOnce(() => {
      throw new Error("clone failed");
    });

    expect(() => selectionClipboardBare(selected, root, "markdown")).toThrow(
      "clone failed",
    );
    expect(isBareCode()).toBe(false);
    expect(selectionClipboard(selected, root, "markdown").text).toContain(
      "```ts\nconst answer = 1;\n```",
    );
  });
});
