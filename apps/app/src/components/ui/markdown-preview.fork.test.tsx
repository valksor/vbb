// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { LazyMarkdownHtml } from "./lazy-markdown-html";
import { MarkdownPreview } from "./markdown-preview";

beforeAll(() => LazyMarkdownHtml.preload());

afterEach(() => {
  cleanup();
});

describe("MarkdownPreview", () => {
  describe("ordered list numbering", () => {
    function itemValues(container: ParentNode): (string | null)[] {
      return Array.from(container.querySelectorAll("li")).map((item) =>
        item.getAttribute("value"),
      );
    }

    it("shows the typed numbers when numbering follows the source", () => {
      const { container } = render(
        <MarkdownPreview
          content={"4. a\n1. b\n2. c\n3. d"}
          orderedListNumbering="source"
        />,
      );

      expect(itemValues(container)).toEqual(["4", "1", "2", "3"]);
    });

    it("keeps CommonMark numbering by default", () => {
      const { container } = render(
        <MarkdownPreview content={"4. a\n1. b\n2. c\n3. d"} />,
      );

      expect(itemValues(container)).toEqual([null, null, null, null]);
      expect(container.querySelector("ol")?.getAttribute("start")).toBe("4");
    });

    it("numbers nested ordered lists from their own source", () => {
      const { container } = render(
        <MarkdownPreview
          content={"1. a\n\n   7. x\n   3. y\n\n2. b"}
          orderedListNumbering="source"
        />,
      );

      const [outer, nested] = Array.from(container.querySelectorAll("ol"));
      expect(itemValues(outer!.parentElement!)).toEqual(["1", "7", "3", "2"]);
      expect(
        Array.from(nested!.querySelectorAll(":scope > li")).map((item) =>
          item.getAttribute("value"),
        ),
      ).toEqual(["7", "3"]);
    });

    it("reads the number from lists that use a closing parenthesis", () => {
      const { container } = render(
        <MarkdownPreview
          content={"5) a\n2) b"}
          orderedListNumbering="source"
        />,
      );

      expect(itemValues(container)).toEqual(["5", "2"]);
    });

    it("numbers ordered lists inside blockquotes", () => {
      const { container } = render(
        <MarkdownPreview
          content={"> 3. a\n> 1. b"}
          orderedListNumbering="source"
        />,
      );

      expect(itemValues(container)).toEqual(["3", "1"]);
    });

    it("leaves a list typed with the same number on every line auto-numbered", () => {
      const { container } = render(
        <MarkdownPreview
          content={"1. a\n1. b\n1. c"}
          orderedListNumbering="source"
        />,
      );

      expect(itemValues(container)).toEqual([null, null, null]);
    });

    it("keeps repeated typed numbers when the list is not uniform", () => {
      const { container } = render(
        <MarkdownPreview
          content={"1. a\n1. b\n2. c"}
          orderedListNumbering="source"
        />,
      );

      expect(itemValues(container)).toEqual(["1", "1", "2"]);
    });

    it("leaves bullet lists without a value", () => {
      const { container } = render(
        <MarkdownPreview
          content={"- a\n- b\n\n1. c\n2. d"}
          orderedListNumbering="source"
        />,
      );

      expect(itemValues(container)).toEqual([null, null, "1", "2"]);
    });

    it("sizes the marker column from the widest typed number", () => {
      const { container } = render(
        <MarkdownPreview
          content={"4. a\n100. b"}
          orderedListNumbering="source"
        />,
      );

      expect(
        container
          .querySelector("ol")
          ?.style.getPropertyValue("--markdown-list-marker-digits"),
      ).toBe("3");
    });
  });
});
