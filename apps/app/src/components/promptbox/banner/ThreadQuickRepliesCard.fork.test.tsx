// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadQuickRepliesCard } from "./ThreadQuickRepliesCard";

afterEach(cleanup);

describe("ThreadQuickRepliesCard", () => {
  it("renders one button per message with its Send name", () => {
    render(
      <ThreadQuickRepliesCard
        messages={["continue", "run the tests"]}
        onSend={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Send “continue”" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Send “run the tests”" }),
    ).toBeTruthy();
  });

  it("sends the clicked message", () => {
    const onSend = vi.fn();
    render(
      <ThreadQuickRepliesCard
        messages={["continue", "stop"]}
        onSend={onSend}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send “stop”" }));

    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith("stop");
  });

  it("sends a duplicate message once from its own button", () => {
    const onSend = vi.fn();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      render(
        <ThreadQuickRepliesCard messages={["same", "same"]} onSend={onSend} />,
      );

      fireEvent.click(
        screen.getAllByRole("button", { name: "Send “same”" })[1]!,
      );

      expect(onSend).toHaveBeenCalledOnce();
      expect(onSend).toHaveBeenCalledWith("same");
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
