// @vitest-environment jsdom

import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Provider as JotaiProvider, createStore } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { quickRepliesAtom } from "@/components/promptbox/banner/quick-replies-preference";
import { QuickRepliesSetting } from "./QuickRepliesSetting";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderSetting(replies: readonly string[] = []) {
  const store = createStore();
  store.set(quickRepliesAtom, [...replies]);
  render(
    <JotaiProvider store={store}>
      <QuickRepliesSetting />
    </JotaiProvider>,
  );
  return store;
}

describe("QuickRepliesSetting", () => {
  it("refreshes every row when an unfocused remote update arrives", async () => {
    const store = renderSetting();

    act(() => {
      store.set(quickRepliesAtom, ["remote one", "remote two"]);
    });

    await waitFor(() => {
      expect(
        (screen.getByLabelText("Quick reply 1") as HTMLTextAreaElement).value,
      ).toBe("remote one");
      expect(
        (screen.getByLabelText("Quick reply 2") as HTMLTextAreaElement).value,
      ).toBe("remote two");
    });
  });

  it("keeps the latest remote rows when an untouched focused row blurs", async () => {
    const store = renderSetting(["draft"]);
    const row = screen.getByLabelText("Quick reply 1");

    fireEvent.focus(row);
    act(() => {
      store.set(quickRepliesAtom, ["remote one", "remote two"]);
    });
    fireEvent.blur(row);

    await waitFor(() => {
      expect(store.get(quickRepliesAtom)).toStrictEqual([
        "remote one",
        "remote two",
      ]);
      expect(
        (screen.getByLabelText("Quick reply 1") as HTMLTextAreaElement).value,
      ).toBe("remote one");
      expect(
        (screen.getByLabelText("Quick reply 2") as HTMLTextAreaElement).value,
      ).toBe("remote two");
    });
  });

  it("keeps the latest remote rows when a focused edit is reverted before blur", async () => {
    const store = renderSetting(["draft"]);
    const row = screen.getByLabelText("Quick reply 1");

    fireEvent.focus(row);
    fireEvent.change(row, { target: { value: "local change" } });
    fireEvent.change(row, { target: { value: "draft" } });
    act(() => {
      store.set(quickRepliesAtom, ["remote one", "remote two"]);
    });
    fireEvent.blur(row);

    await waitFor(() => {
      expect(store.get(quickRepliesAtom)).toStrictEqual([
        "remote one",
        "remote two",
      ]);
      expect(
        (screen.getByLabelText("Quick reply 1") as HTMLTextAreaElement).value,
      ).toBe("remote one");
      expect(
        (screen.getByLabelText("Quick reply 2") as HTMLTextAreaElement).value,
      ).toBe("remote two");
    });
  });

  it("commits a dirty edit when its row blurs", async () => {
    const store = renderSetting(["before"]);
    const row = screen.getByLabelText("Quick reply 1");

    fireEvent.focus(row);
    fireEvent.change(row, { target: { value: " after " } });
    fireEvent.blur(row);

    await waitFor(() => {
      expect(store.get(quickRepliesAtom)).toStrictEqual(["after"]);
    });
  });

  it("keeps a dirty draft visible when the saved list changes during focus", async () => {
    const store = renderSetting(["A"]);
    const row = screen.getByLabelText("Quick reply 1");

    fireEvent.focus(row);
    fireEvent.change(row, { target: { value: "local A" } });
    act(() => {
      store.set(quickRepliesAtom, ["A", "remote B"]);
    });
    fireEvent.blur(row);

    await waitFor(() => {
      expect(store.get(quickRepliesAtom)).toStrictEqual(["A", "remote B"]);
      expect(
        (screen.getByLabelText("Quick reply 1") as HTMLTextAreaElement).value,
      ).toBe("local A");
      expect(screen.getByRole("alert").textContent).toContain(
        "Quick replies changed in another window. Reload saved replies before saving your edits.",
      );
    });

    act(() => {
      store.set(quickRepliesAtom, ["A", "remote B", "remote C"]);
    });

    await waitFor(() => {
      expect(store.get(quickRepliesAtom)).toStrictEqual([
        "A",
        "remote B",
        "remote C",
      ]);
      expect(
        (screen.getByLabelText("Quick reply 1") as HTMLTextAreaElement).value,
      ).toBe("local A");
      expect(screen.getByRole("alert")).not.toBeNull();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Reload saved replies" }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
      expect(
        (screen.getByLabelText("Quick reply 1") as HTMLTextAreaElement).value,
      ).toBe("A");
      expect(
        (screen.getByLabelText("Quick reply 2") as HTMLTextAreaElement).value,
      ).toBe("remote B");
      expect(
        (screen.getByLabelText("Quick reply 3") as HTMLTextAreaElement).value,
      ).toBe("remote C");
    });

    const reloadedRow = screen.getByLabelText("Quick reply 1");
    fireEvent.focus(reloadedRow);
    fireEvent.change(reloadedRow, { target: { value: "after reload" } });
    fireEvent.blur(reloadedRow);

    await waitFor(() => {
      expect(store.get(quickRepliesAtom)).toStrictEqual([
        "after reload",
        "remote B",
        "remote C",
      ]);
    });
  });

  it.each([
    ["Cmd", { metaKey: true }],
    ["Ctrl", { ctrlKey: true }],
  ])("commits a dirty row on %s+Enter", async (_key, modifier) => {
    const store = renderSetting();
    let writeCount = 0;
    const unsubscribe = store.sub(quickRepliesAtom, () => {
      writeCount += 1;
    });

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const row = screen.getByLabelText("Quick reply 1");
    fireEvent.focus(row);
    fireEvent.change(row, { target: { value: "send now" } });
    fireEvent.keyDown(row, { key: "Enter", ...modifier });

    await waitFor(() => {
      expect(store.get(quickRepliesAtom)).toStrictEqual(["send now"]);
    });
    fireEvent.blur(row);
    expect(writeCount).toBe(1);
    unsubscribe();
  });

  it("keeps ordinary Enter as multiline text without committing", async () => {
    const store = renderSetting();

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const row = screen.getByLabelText("Quick reply 1");
    fireEvent.focus(row);
    const enter = createEvent.keyDown(row, {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    });
    fireEvent(row, enter);
    fireEvent.change(row, { target: { value: "first line\nsecond line" } });

    expect(enter.defaultPrevented).toBe(false);
    expect((row as HTMLTextAreaElement).value).toBe("first line\nsecond line");
    expect(store.get(quickRepliesAtom)).toStrictEqual([]);
  });

  it("persists an empty list when the last row is removed", async () => {
    const store = renderSetting(["only reply"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove quick reply" }));

    await waitFor(() => {
      expect(store.get(quickRepliesAtom)).toStrictEqual([]);
      expect(screen.queryByRole("textbox")).toBeNull();
    });
  });

  it("adds a blank fiftieth row and then disables Add", async () => {
    renderSetting(Array.from({ length: 49 }, (_, index) => `reply ${index}`));
    const addButton = screen.getByRole("button", { name: "Add" });

    expect((addButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(addButton);

    expect(
      (screen.getByLabelText("Quick reply 50") as HTMLTextAreaElement).value,
    ).toBe("");
    expect((addButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("normalizes a cleared fiftieth row so Add can create its replacement", async () => {
    const store = renderSetting(
      Array.from({ length: 50 }, (_, index) => `reply ${index}`),
    );
    const row = screen.getByLabelText("Quick reply 50");

    fireEvent.focus(row);
    fireEvent.change(row, { target: { value: "" } });
    fireEvent.blur(row);

    await waitFor(() => {
      expect(store.get(quickRepliesAtom)).toStrictEqual(
        Array.from({ length: 49 }, (_, index) => `reply ${index}`),
      );
      expect(screen.queryByLabelText("Quick reply 50")).toBeNull();
      expect(
        (screen.getByRole("button", { name: "Add" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    });

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(
      (screen.getByLabelText("Quick reply 50") as HTMLTextAreaElement).value,
    ).toBe("");
  });

  it("sets the text control maximum length to 1024 characters", () => {
    renderSetting();

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const row = screen.getByLabelText("Quick reply 1");

    expect(row.getAttribute("maxlength")).toBe("1024");
    expect((row as HTMLTextAreaElement).maxLength).toBe(1024);
  });

  it("removes a neighboring row from the latest remote list after focus moves", async () => {
    const store = renderSetting(["draft one", "draft two"]);
    const focusedRow = screen.getByLabelText("Quick reply 2");

    fireEvent.focus(focusedRow);
    act(() => {
      store.set(quickRepliesAtom, ["remote one", "remote two", "remote three"]);
    });
    fireEvent.blur(focusedRow);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Remove quick reply" })[0]!,
    );

    await waitFor(() => {
      expect(store.get(quickRepliesAtom)).toStrictEqual([
        "remote two",
        "remote three",
      ]);
      expect(
        (screen.getByLabelText("Quick reply 1") as HTMLTextAreaElement).value,
      ).toBe("remote two");
      expect(
        (screen.getByLabelText("Quick reply 2") as HTMLTextAreaElement).value,
      ).toBe("remote three");
    });
  });
});
