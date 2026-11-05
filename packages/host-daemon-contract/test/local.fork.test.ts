import { describe, expect, it } from "vitest";
import {
  OPEN_IN_TARGET_COMMAND_MAX_LENGTH,
  openInTargetRequestSchema,
  workspaceOpenTargetSchema,
} from "../src/index.js";

describe("openInTargetRequestSchema commands", () => {
  const baseRequest = {
    lineNumber: null,
    path: "/tmp/workspace",
    targetId: "terminal",
  };

  it("parses a multi-line command with defaults", () => {
    expect(
      openInTargetRequestSchema.parse({
        ...baseRequest,
        command: "echo one\necho two",
      }),
    ).toEqual({
      columnNumber: null,
      command: "echo one\necho two",
      context: { kind: "local" },
      lineNumber: null,
      path: "/tmp/workspace",
      targetId: "terminal",
    });
  });

  it("accepts the four language tags and rejects others", () => {
    for (const language of ["bash", "sh", "shell", "zsh"] as const) {
      expect(
        openInTargetRequestSchema.parse({
          ...baseRequest,
          command: "true",
          language,
        }).language,
      ).toBe(language);
    }
    expect(() =>
      openInTargetRequestSchema.parse({
        ...baseRequest,
        command: "true",
        language: "fish",
      }),
    ).toThrow();
  });

  it("rejects NUL and C0 control characters except newline, tab, and carriage return", () => {
    expect(() =>
      openInTargetRequestSchema.parse({ ...baseRequest, command: "a\u0000b" }),
    ).toThrow();
    expect(() =>
      openInTargetRequestSchema.parse({ ...baseRequest, command: "a\u0001b" }),
    ).toThrow();
    expect(() =>
      openInTargetRequestSchema.parse({ ...baseRequest, command: "a\u001fb" }),
    ).toThrow();
    for (const allowed of ["\n", "\r", "\t"]) {
      expect(
        openInTargetRequestSchema.parse({
          ...baseRequest,
          command: `a${allowed}b`,
        }).command,
      ).toBeDefined();
    }
  });

  it("rejects bidi control characters", () => {
    for (const bidi of ["‪", "‮", "⁦", "⁩", "؜"]) {
      expect(() =>
        openInTargetRequestSchema.parse({
          ...baseRequest,
          command: `echo ${bidi}text`,
        }),
      ).toThrow();
    }
  });

  it("rejects the shared invisible and reordering characters", () => {
    for (const invisible of [
      "‎",
      "‏",
      "​",
      "⁠",
      "﻿",
    ]) {
      expect(() =>
        openInTargetRequestSchema.parse({
          ...baseRequest,
          command: `echo ${invisible}text`,
        }),
      ).toThrow();
    }
  });

  it("allows zero-width joiner, zero-width non-joiner, and soft hyphen", () => {
    for (const allowed of ["‍", "‌", "­"]) {
      expect(
        openInTargetRequestSchema.parse({
          ...baseRequest,
          command: `echo ${allowed}text`,
        }).command,
      ).toBe(`echo ${allowed}text`);
    }
  });

  it("requires command when language is present", () => {
    expect(() =>
      openInTargetRequestSchema.parse({ ...baseRequest, language: "bash" }),
    ).toThrow();
  });

  it("accepts command without language", () => {
    expect(
      openInTargetRequestSchema.parse({
        ...baseRequest,
        command: "true",
      }).language,
    ).toBeUndefined();
  });

  it("enforces the command length cap", () => {
    expect(
      openInTargetRequestSchema.parse({
        ...baseRequest,
        command: "a".repeat(OPEN_IN_TARGET_COMMAND_MAX_LENGTH),
      }).command,
    ).toHaveLength(OPEN_IN_TARGET_COMMAND_MAX_LENGTH);
    expect(() =>
      openInTargetRequestSchema.parse({
        ...baseRequest,
        command: "a".repeat(OPEN_IN_TARGET_COMMAND_MAX_LENGTH + 1),
      }),
    ).toThrow();
  });

  it("still requires lineNumber for command requests", () => {
    expect(() =>
      openInTargetRequestSchema.parse({
        path: "/tmp/workspace",
        targetId: "terminal",
        command: "true",
      }),
    ).toThrow();
  });
});

describe("workspaceOpenTargetSchema runCommand", () => {
  it("accepts an optional runCommand capability", () => {
    expect(
      workspaceOpenTargetSchema.parse({
        id: "terminal",
        label: "Terminal",
        capabilities: {
          openDirectory: true,
          openFile: true,
          openFileAtLine: true,
          runCommand: true,
        },
      }).capabilities.runCommand,
    ).toBe(true);
  });
});
