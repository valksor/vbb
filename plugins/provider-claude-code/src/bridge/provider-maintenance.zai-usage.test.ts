import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isZaiUsageBaseUrl,
  nonessentialTrafficDisabled,
} from "../token-profile-rules.js";
import { getClaudeProviderUsage } from "./provider-maintenance.js";

const TOKEN = "test-glm-token";
const GLM_ENV = {
  ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
  ANTHROPIC_MODEL: "glm-5.3[1m]",
};

const USAGE_OK_BODY = {
  code: 200,
  success: true,
  data: {
    level: "max",
    limits: [
      { type: "CREDIT_LIMIT", unit: 3, number: 5, percentage: 0 },
      {
        type: "CREDIT_LIMIT",
        unit: 6,
        number: 1,
        percentage: 29,
        nextResetTime: 1793089363976,
      },
    ],
  },
};

let tempDir: string;
let tokenFile: string;

function tokenProfile(env: Record<string, string> = GLM_ENV) {
  return { kind: "token" as const, authTokenFile: tokenFile, env };
}

function okResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function stubFetch(response: Response | Error): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn();
  if (response instanceof Error) fetchMock.mockRejectedValue(response);
  else fetchMock.mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function usage(env?: Record<string, string>) {
  return getClaudeProviderUsage(tokenProfile(env));
}

function usageMessage(result: Awaited<ReturnType<typeof usage>>): string {
  return result.supported && result.usage.status === "error"
    ? result.usage.message
    : "";
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "bb-zai-usage-"));
  tokenFile = join(tempDir, "glm.token");
  writeFileSync(tokenFile, TOKEN);
  chmodSync(tokenFile, 0o600);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("isZaiUsageBaseUrl", () => {
  it.each([
    "https://api.z.ai/api/anthropic",
    "https://open.bigmodel.cn/api/anthropic",
    "https://dev.bigmodel.cn/api/anthropic",
    "https://API.Z.AI/api/anthropic",
    "https://api.z.ai:8443/api/anthropic",
  ])("accepts %s", (url) => {
    expect(isZaiUsageBaseUrl(url)).toBe(true);
  });

  it.each([
    "http://api.z.ai/api/anthropic",
    "https://api.z.ai.evil.example/api/anthropic",
    "https://evilz.ai/api/anthropic",
    "https://api.z.ai.example.com/api/anthropic",
    "https://example.com/api/anthropic",
    "not a url",
    undefined,
  ])("rejects %s", (url) => {
    expect(isZaiUsageBaseUrl(url)).toBe(false);
  });
});

describe("nonessentialTrafficDisabled", () => {
  it.each(["1", "true", "TRUE", "yes"])("is true for %s", (value) => {
    expect(
      nonessentialTrafficDisabled({
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: value,
      }),
    ).toBe(true);
  });

  it.each(["0", "false", "FALSE", " 0 ", ""])("is false for %s", (value) => {
    expect(
      nonessentialTrafficDisabled({
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: value,
      }),
    ).toBe(false);
  });

  it("is false when the key is absent", () => {
    expect(nonessentialTrafficDisabled({})).toBe(false);
  });
});

describe("the z.ai token profile usage", () => {
  it("fetches the quota endpoint on the base URL origin with the raw token", async () => {
    const fetchMock = stubFetch(okResponse(USAGE_OK_BODY));

    const result = await usage();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(String(url)).toBe("https://api.z.ai/api/monitor/usage/quota/limit");
    expect(init.headers).toEqual({
      Authorization: TOKEN,
      Accept: "application/json",
    });
    expect(init.redirect).toBe("error");
    expect(result).toEqual({
      supported: true,
      usage: {
        status: "ok",
        accountEmail: null,
        planLabel: "GLM Coding Max",
        plan: null,
        accountKey: null,
        windows: [
          {
            kind: "five-hour",
            label: "Five-hour limit",
            usedPercent: 0,
            resetsAt: null,
          },
          {
            kind: "weekly",
            label: "Weekly limit",
            usedPercent: 29,
            resetsAt: new Date(1793089363976).toISOString(),
          },
        ],
      },
    });
  });

  it("sends the request to the dev.bigmodel.cn origin the CLI already uses", async () => {
    const fetchMock = stubFetch(okResponse(USAGE_OK_BODY));

    await usage({
      ANTHROPIC_BASE_URL: "https://dev.bigmodel.cn/api/anthropic",
      ANTHROPIC_MODEL: "glm-5.3[1m]",
    });

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://dev.bigmodel.cn/api/monitor/usage/quota/limit",
    );
  });

  it("stays unsupported for a non-z.ai base URL without fetching", async () => {
    const fetchMock = stubFetch(okResponse(USAGE_OK_BODY));

    const result = await usage({
      ANTHROPIC_BASE_URL: "https://llm.example.com/v1",
      ANTHROPIC_MODEL: "glm-5.3[1m]",
    });

    expect(result).toEqual({ supported: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["1", "true", "yes"])(
    "disables usage when CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is %s in the profile env",
    async (value) => {
      const fetchMock = stubFetch(okResponse(USAGE_OK_BODY));

      const result = await usage({
        ...GLM_ENV,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: value,
      });

      expect(result).toEqual({ supported: false });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(["0", "false", "FALSE", " 0 ", ""])(
    "keeps usage on when CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is %s in the profile env",
    async (value) => {
      const fetchMock = stubFetch(okResponse(USAGE_OK_BODY));

      const result = await usage({
        ...GLM_ENV,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: value,
      });

      expect(result.supported && result.usage.status).toBe("ok");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("ignores an ambient CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC value", async () => {
    vi.stubEnv("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1");
    const fetchMock = stubFetch(okResponse(USAGE_OK_BODY));

    const result = await usage();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.supported && result.usage.status).toBe("ok");
  });

  it("reports unauthenticated without fetching when the token file is missing", async () => {
    rmSync(tokenFile);
    const fetchMock = stubFetch(okResponse(USAGE_OK_BODY));

    const result = await usage();

    expect(result).toEqual({
      supported: true,
      usage: { status: "unauthenticated" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports unauthenticated without fetching when the token file is unreadable", async () => {
    chmodSync(tokenFile, 0o644);
    const fetchMock = stubFetch(okResponse(USAGE_OK_BODY));

    const result = await usage();

    expect(result).toEqual({
      supported: true,
      usage: { status: "unauthenticated" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403])("maps a body-level code %i to expired", async (code) => {
    stubFetch(
      okResponse({ code, msg: "token expired or incorrect", success: false }),
    );

    const result = await usage();

    expect(result).toEqual({ supported: true, usage: { status: "expired" } });
  });

  it.each([401, 403])("maps HTTP %i to expired", async (status) => {
    stubFetch(okResponse({ msg: "denied", success: false }, status));

    const result = await usage();

    expect(result).toEqual({ supported: true, usage: { status: "expired" } });
  });

  it("maps HTTP 500 to a fixed error message", async () => {
    stubFetch(okResponse({}, 500));

    const result = await usage();

    expect(result).toEqual({
      supported: true,
      usage: {
        status: "error",
        message: "GLM usage request failed (HTTP 500).",
        planLabel: null,
        accountEmail: null,
      },
    });
  });

  it("includes a sanitized msg for a success:false body", async () => {
    stubFetch(okResponse({ code: 400, msg: "quota is gone", success: false }));

    const result = await usage();

    expect(result).toEqual({
      supported: true,
      usage: {
        status: "error",
        message: "GLM usage request failed: quota is gone",
        planLabel: null,
        accountEmail: null,
      },
    });
  });

  it("drops a control-character msg and an over-long msg", async () => {
    stubFetch(okResponse({ code: 400, msg: "bad​msg", success: false }));
    const first = await usage();
    stubFetch(okResponse({ code: 400, msg: "x".repeat(201), success: false }));
    const second = await usage();

    expect(usageMessage(first)).toBe("GLM usage request failed.");
    expect(usageMessage(second)).toBe("GLM usage request failed.");
  });

  it("maps a non-JSON body to the malformed message", async () => {
    stubFetch(new Response("<html>Service unavailable</html>"));

    const result = await usage();

    expect(result).toEqual({
      supported: true,
      usage: {
        status: "error",
        message: "GLM usage response was malformed.",
        planLabel: null,
        accountEmail: null,
      },
    });
  });

  it("maps a success:true body without limits to an error", async () => {
    stubFetch(okResponse({ code: 200, success: true, data: { level: "max" } }));

    const result = await usage();

    expect(result.supported && result.usage).toMatchObject({
      status: "error",
      message: "GLM usage response was malformed.",
    });
  });

  it("maps a success:true body with a non-array limits to an error", async () => {
    stubFetch(okResponse({ code: 200, success: true, data: { limits: 3 } }));

    const result = await usage();

    expect(result.supported && result.usage).toMatchObject({
      status: "error",
      message: "GLM usage response was malformed.",
    });
  });

  it("maps a body over 64 KB to the too-large message", async () => {
    stubFetch(new Response("x".repeat(70_000)));

    const result = await usage();

    expect(result).toEqual({
      supported: true,
      usage: {
        status: "error",
        message: "GLM usage response was too large.",
        planLabel: null,
        accountEmail: null,
      },
    });
  });

  it("maps a timeout to the fixed timeout message", async () => {
    stubFetch(
      Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      }),
    );

    const result = await usage();

    expect(result).toEqual({
      supported: true,
      usage: {
        status: "error",
        message: "GLM usage request timed out.",
        planLabel: null,
        accountEmail: null,
      },
    });
  });

  it("maps a redirect rejection to the fixed failure message", async () => {
    stubFetch(new TypeError("fetch failed"));

    const result = await usage();

    expect(result).toEqual({
      supported: true,
      usage: {
        status: "error",
        message: "GLM usage request failed.",
        planLabel: null,
        accountEmail: null,
      },
    });
  });

  it("drops entries without a finite percentage", async () => {
    stubFetch(
      new Response(
        '{"code":200,"success":true,"data":{"limits":[{"unit":3,"number":5,"percentage":10},{"unit":6,"number":1,"percentage":1e999},{"unit":6,"number":1,"percentage":"high"},{"unit":6,"number":1}]}}',
      ),
    );

    const result = await usage();

    expect(result.supported && result.usage).toMatchObject({
      status: "ok",
      windows: [
        {
          kind: "five-hour",
          label: "Five-hour limit",
          usedPercent: 10,
          resetsAt: null,
        },
      ],
    });
  });

  it("nulls a missing and an out-of-range nextResetTime and keeps an in-range one", async () => {
    stubFetch(
      okResponse({
        code: 200,
        success: true,
        data: {
          limits: [
            { unit: 3, number: 5, percentage: 1 },
            { unit: 6, number: 1, percentage: 2, nextResetTime: 0 },
            {
              type: "TIME_LIMIT",
              percentage: 3,
              nextResetTime: 1577836800000,
            },
            {
              type: "TIME_LIMIT",
              percentage: 4,
              nextResetTime: 7258118400000,
            },
          ],
        },
      }),
    );

    const result = await usage();

    expect(result.supported && result.usage).toMatchObject({
      status: "ok",
      windows: [
        { label: "Five-hour limit", resetsAt: null },
        { label: "Weekly limit", resetsAt: null },
        { label: "MCP tools (monthly)", resetsAt: "2020-01-01T00:00:00.000Z" },
        { label: "MCP tools (monthly) (2)", resetsAt: null },
      ],
    });
  });

  it("numbers unknown entries uniquely", async () => {
    stubFetch(
      okResponse({
        code: 200,
        success: true,
        data: {
          limits: [
            { type: "FOO", unit: 1, number: 1, percentage: 5 },
            { type: "BAR", percentage: 6 },
          ],
        },
      }),
    );

    const result = await usage();

    expect(result.supported && result.usage).toMatchObject({
      status: "ok",
      windows: [
        { kind: "custom", label: "Usage limit 1", usedPercent: 5 },
        { kind: "custom", label: "Usage limit 2", usedPercent: 6 },
      ],
    });
  });

  it("suffixes repeated known entries", async () => {
    stubFetch(
      okResponse({
        code: 200,
        success: true,
        data: {
          limits: [
            { unit: 3, number: 5, percentage: 1 },
            { unit: 3, number: 5, percentage: 2 },
            { type: "TIME_LIMIT", percentage: 3 },
            { type: "TIME_LIMIT", percentage: 4 },
            { type: "TIME_LIMIT", percentage: 5 },
          ],
        },
      }),
    );

    const result = await usage();

    expect(result.supported && result.usage).toMatchObject({
      status: "ok",
      windows: [
        { kind: "five-hour", label: "Five-hour limit", usedPercent: 1 },
        { kind: "custom", label: "Five-hour limit (2)", usedPercent: 2 },
        { kind: "custom", label: "MCP tools (monthly)", usedPercent: 3 },
        { kind: "custom", label: "MCP tools (monthly) (2)", usedPercent: 4 },
        { kind: "custom", label: "MCP tools (monthly) (3)", usedPercent: 5 },
      ],
    });
  });

  it("keeps the response ok when an unknown entry type appears", async () => {
    stubFetch(
      okResponse({
        code: 200,
        success: true,
        data: {
          limits: ["garbage", 42, null, { unit: 3, number: 5, percentage: 7 }],
        },
      }),
    );

    const result = await usage();

    expect(result.supported && result.usage).toMatchObject({
      status: "ok",
      windows: [
        { kind: "five-hour", label: "Five-hour limit", usedPercent: 7 },
      ],
    });
  });

  it("gives no plan label for an invalid level", async () => {
    stubFetch(
      okResponse({
        code: 200,
        success: true,
        data: { level: "MAX!", limits: [] },
      }),
    );

    const result = await usage();

    expect(result.supported && result.usage).toMatchObject({
      status: "ok",
      planLabel: null,
      windows: [],
    });
  });
});
