// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { TerminalOutputBlock } from "./TerminalOutputBlock";

afterEach(cleanup);

it("lets the caller replace the default output max height", () => {
  const { container } = render(
    <TerminalOutputBlock
      commandLine="tail -f log"
      exitCode={null}
      metadataLines={[]}
      output="line"
      scrollClassName="max-h-[min(20rem,40dvh)]"
      streaming
    />,
  );

  const scrollArea = container.querySelector("[data-detail-scroll-area]");
  expect(scrollArea?.className).toContain("max-h-[min(20rem,40dvh)]");
  expect(scrollArea?.className).not.toContain("max-h-[288px]");
});

it("makes the output scroll area keyboard-focusable only when labelled", () => {
  const props = {
    commandLine: "tail -f log",
    exitCode: null,
    metadataLines: [],
    output: "line",
    streaming: false,
  };
  const { container, rerender } = render(<TerminalOutputBlock {...props} />);
  const plain = container.querySelector("[data-detail-scroll-area]");
  expect(plain?.getAttribute("tabindex")).toBeNull();
  expect(plain?.getAttribute("aria-label")).toBeNull();

  rerender(<TerminalOutputBlock {...props} scrollAriaLabel="Command output" />);

  const labelled = screen.getByRole("region", { name: "Command output" });
  expect(labelled.getAttribute("tabindex")).toBe("0");
  expect(labelled.hasAttribute("data-detail-scroll-area")).toBe(true);
});
