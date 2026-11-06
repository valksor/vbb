// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import {
  readSelectedMessageMarkdown,
  SelectableMessageProse,
} from "./SelectableMessageProse";

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  cleanup();
});

function copyRange(range: Range) {
  window.getSelection()!.addRange(range);
  const data = new Map<string, string>();
  const accepted = fireEvent.copy(document, {
    clipboardData: {
      setData: (type: string, value: string) => data.set(type, value),
    },
  });
  return { data, accepted };
}

it("copies inline code as plain text without backticks", () => {
  const { container } = render(
    <SelectableMessageProse>
      <MarkdownPreview content={"Run `pnpm build` now."} />
    </SelectableMessageProse>,
  );
  const range = document.createRange();
  range.selectNodeContents(container.querySelector("p")!);
  expect(copyRange(range).data.get("text/plain")).toBe("Run pnpm build now.");
});

it("keeps backticks around inline code when reading the selection as message markdown", () => {
  const { container } = render(
    <SelectableMessageProse>
      <MarkdownPreview content={"Run `pnpm build` now."} />
    </SelectableMessageProse>,
  );
  const range = document.createRange();
  range.selectNodeContents(container.querySelector("p")!);
  window.getSelection()!.addRange(range);
  expect(readSelectedMessageMarkdown()).toBe("Run `pnpm build` now.");
});

it("copies a literal prose backtick without a backslash but escapes it as message markdown", () => {
  const { container } = render(
    <SelectableMessageProse>
      <p>{"Use the ` key and 2*3"}</p>
    </SelectableMessageProse>,
  );
  const range = document.createRange();
  range.selectNodeContents(container.querySelector("p")!);
  expect(copyRange(range).data.get("text/plain")).toBe(
    "Use the ` key and 2\\*3",
  );
  expect(readSelectedMessageMarkdown()).toBe("Use the \\` key and 2\\*3");
});

it("copies a paragraph and fenced code block without backticks but keeps the fence as message markdown", () => {
  const { container } = render(
    <SelectableMessageProse>
      <MarkdownPreview content={"Run it:\n\n```ts\nconst x = 1;\n```"} />
    </SelectableMessageProse>,
  );
  const range = document.createRange();
  range.selectNodeContents(container.firstElementChild!);
  const text = copyRange(range).data.get("text/plain")!;
  expect(text).toBe("Run it:\n\nconst x = 1;");
  expect(text).not.toContain("`");
  expect(readSelectedMessageMarkdown()).toContain("```ts\nconst x = 1;\n```");
});

it("copies fenced code across messages without backticks", () => {
  const { container } = render(
    <>
      <SelectableMessageProse>
        <MarkdownPreview content={"Intro text."} />
      </SelectableMessageProse>
      <SelectableMessageProse>
        <MarkdownPreview content={"Run it:\n\n```ts\nconst x = 1;\n```"} />
      </SelectableMessageProse>
    </>,
  );
  const range = document.createRange();
  const last = container.lastElementChild!;
  range.setStart(container.firstElementChild!, 0);
  range.setEnd(last, last.childNodes.length);
  const text = copyRange(range).data.get("text/plain")!;
  expect(text).toContain("const x = 1;");
  expect(text).not.toContain("`");
});
