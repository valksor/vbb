import { expect, it, vi } from "vitest";
import {
  buildBridgeInjectionScript,
  type NativeShellApi,
  type NativeShellHandshake,
} from "../src/index.js";

const handshake: NativeShellHandshake = {
  bridgeVersion: 2,
  appVersion: "0.39.0",
  platform: "ios",
  profileMode: "connect",
  secureContext: true,
  safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
  capabilities: [
    "haptic",
    "badge",
    "share",
    "open-external",
    "safe-area",
    "open-native",
  ],
};

interface FakeWindow {
  location: { href: string };
  ReactNativeWebView: { postMessage(raw: string): void };
  bb?: { native?: NativeShellApi };
}

function installBridge(
  overrides: Partial<NativeShellHandshake> = {},
  page: Record<string, unknown> = {},
) {
  const posted: string[] = [];
  const fakeWindow: FakeWindow = {
    location: { href: "https://test/threads/one" },
    ReactNativeWebView: {
      postMessage: (raw: string) => {
        posted.push(raw);
      },
    },
  };
  const run = (script: string) => {
    // eslint-disable-next-line no-new-func
    new Function(
      "window",
      "document",
      "DataTransfer",
      "ClipboardEvent",
      "fetch",
      script,
    )(
      fakeWindow,
      page.document,
      page.DataTransfer,
      page.ClipboardEvent,
      page.fetch,
    );
  };
  run(buildBridgeInjectionScript({ ...handshake, ...overrides }));
  const native = fakeWindow.bb?.native;
  if (native === undefined) throw new Error("bridge did not install");
  return { native, posted, run, fakeWindow };
}

it("rejects immediately when the native bridge cannot receive a request", async () => {
  vi.useFakeTimers();
  const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const { native, fakeWindow } = installBridge();
    fakeWindow.ReactNativeWebView.postMessage = () => {
      throw new Error("bridge detached");
    };
    await expect(
      Promise.race([
        native.request("share", { text: "hello" }),
        Promise.resolve("still pending"),
      ]),
    ).rejects.toThrow("native bridge unavailable");
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    consoleWarn.mockRestore();
    vi.useRealTimers();
  }
});
