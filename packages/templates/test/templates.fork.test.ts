import { describe, expect, it } from "vitest";
import { renderTemplate } from "../src/index.js";

describe("@bb/templates", () => {
  it("tells agents a child thread outcome delivery is not a user stop", () => {
    const rendered = renderTemplate("systemMessageChildThreadOutcomeBatch", {
      updates: "@thread:thr_child completed.",
    });

    expect(rendered).toBe(
      [
        "[bb system]",
        "",
        "@thread:thr_child completed.",
        "",
        "bb sent this message, not the user. If it cut off one of your tool calls, that was not a request to stop: check whether that call finished (and whether a state-changing call such as a spawn or commit already took effect), re-run it if you still need it, and continue your current task.",
      ].join("\n"),
    );
  });
});
