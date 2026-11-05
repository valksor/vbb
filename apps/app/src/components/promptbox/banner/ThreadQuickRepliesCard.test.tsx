// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadQuickRepliesCard } from "./ThreadQuickRepliesCard";

afterEach(cleanup);

describe("ThreadQuickRepliesCard", () => {
  it("renders accessible buttons and sends the clicked duplicate", () => {
    const onSend = vi.fn();
    render(
      <ThreadQuickRepliesCard messages={["same", "same"]} onSend={onSend} />,
    );
    const buttons = screen.getAllByRole("button", { name: "Send “same”" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]!);
    expect(onSend).toHaveBeenCalledExactlyOnceWith("same");
  });

  it("does not render for an empty list", () => {
    const { container } = render(
      <ThreadQuickRepliesCard messages={[]} onSend={() => {}} />,
    );
    expect(container.childElementCount).toBe(0);
  });
});
