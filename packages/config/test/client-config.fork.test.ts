import { describe, expect, it } from "vitest";
import { parseClientConfig } from "../src/client-config.js";

describe("client config", () => {
  it("defaults runCommandEnabled to on when the key is absent", () => {
    expect(parseClientConfig({ servers: {} }).runCommandEnabled).toBeUndefined();
    expect(
      parseClientConfig({
        runCommandEnabled: false,
        servers: {},
      }).runCommandEnabled,
    ).toBe(false);
    expect(
      parseClientConfig({
        runCommandEnabled: true,
        servers: {},
      }).runCommandEnabled,
    ).toBe(true);
  });

  it("rejects unknown keys and malformed runCommandEnabled values", () => {
    expect(() =>
      parseClientConfig({
        runCommandEnabled: true,
        servers: {},
        unexpected: true,
      }),
    ).toThrow();
    expect(() =>
      parseClientConfig({
        runCommandEnabled: "yes",
        servers: {},
      }),
    ).toThrow();
  });
});
