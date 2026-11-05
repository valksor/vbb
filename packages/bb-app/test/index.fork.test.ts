import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runBbApp } from "../src/launcher.js";

describe("bb-app launcher", () => {
  it("preserves runCommandEnabled when ssh-target writers rewrite the client config", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bb-client-run-command-"));
    writeFileSync(
      join(dataDir, "client.json"),
      `${JSON.stringify({
        runCommandEnabled: false,
        servers: {
          "https://bb.example.test": {
            hosts: {
              host_1: { sshAuthority: "devbox" },
            },
          },
        },
      })}\n`,
      "utf8",
    );

    try {
      await runBbApp([
        "--data-dir",
        dataDir,
        "client",
        "ssh-target",
        "set",
        "https://bb.example.test",
        "buildbox",
        "--host-id",
        "host_2",
      ]);
      expect(
        JSON.parse(readFileSync(join(dataDir, "client.json"), "utf8")),
      ).toEqual({
        runCommandEnabled: false,
        servers: {
          "https://bb.example.test": {
            hosts: {
              host_1: { sshAuthority: "devbox" },
              host_2: { sshAuthority: "buildbox" },
            },
          },
        },
      });

      await runBbApp([
        "--data-dir",
        dataDir,
        "client",
        "ssh-target",
        "remove",
        "https://bb.example.test",
        "--host-id",
        "host_2",
      ]);
      expect(
        JSON.parse(readFileSync(join(dataDir, "client.json"), "utf8")),
      ).toEqual({
        runCommandEnabled: false,
        servers: {
          "https://bb.example.test": {
            hosts: {
              host_1: { sshAuthority: "devbox" },
            },
          },
        },
      });

      await runBbApp([
        "--data-dir",
        dataDir,
        "client",
        "ssh-target",
        "remove",
        "https://missing.example.test",
      ]);
      expect(
        JSON.parse(readFileSync(join(dataDir, "client.json"), "utf8")),
      ).toMatchObject({ runCommandEnabled: false });

      await runBbApp([
        "--data-dir",
        dataDir,
        "client",
        "ssh-target",
        "remove",
        "https://bb.example.test",
      ]);
      expect(
        JSON.parse(readFileSync(join(dataDir, "client.json"), "utf8")),
      ).toEqual({ runCommandEnabled: false, servers: {} });
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("round-trips runCommandEnabled through the run-command setter", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bb-client-run-command-"));

    try {
      await runBbApp(["--data-dir", dataDir, "client", "run-command", "off"]);
      expect(
        JSON.parse(readFileSync(join(dataDir, "client.json"), "utf8")),
      ).toEqual({ runCommandEnabled: false, servers: {} });

      await runBbApp(["--data-dir", dataDir, "client", "run-command", "on"]);
      expect(
        JSON.parse(readFileSync(join(dataDir, "client.json"), "utf8")),
      ).toEqual({ runCommandEnabled: true, servers: {} });
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects invalid setter arguments and preserves malformed client config bytes", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bb-client-run-command-"));
    const path = join(dataDir, "client.json");
    const malformed = "{not valid JSON}\n";
    writeFileSync(path, malformed, "utf8");

    try {
      await expect(
        runBbApp(["--data-dir", dataDir, "client", "run-command", "enabled"]),
      ).rejects.toThrow("Usage: bb-app client run-command <on|off>");
      await expect(
        runBbApp(["--data-dir", dataDir, "client", "run-command"]),
      ).rejects.toThrow("Usage: bb-app client run-command <on|off>");
      await expect(
        runBbApp(["--data-dir", dataDir, "client", "run-command", "off"]),
      ).rejects.toThrow();
      expect(readFileSync(path, "utf8")).toBe(malformed);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
