import { expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

async function listPreferences(harness: TestAppHarness): Promise<Response> {
  return harness.app.request("/api/v1/preferences/ui");
}

async function putPreference(
  harness: TestAppHarness,
  key: string,
  body: { expectedRevision: number; value: unknown },
): Promise<Response> {
  return harness.app.request(`/api/v1/preferences/ui/${key}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
}

async function resetPreference(
  harness: TestAppHarness,
  key: string,
): Promise<Response> {
  return harness.app.request(`/api/v1/preferences/ui/${key}`, {
    method: "DELETE",
  });
}

it("persists, validates, and resets quick replies", async () => {
  await withTestHarness(async (harness) => {
    const key = "composer.quickReplies";
    const response = await putPreference(harness, key, {
      expectedRevision: 0,
      value: [" continue ", "run the tests"],
    });
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({
      key,
      revision: 1,
      value: ["continue", "run the tests"],
    });
    expect(await readJson(await listPreferences(harness))).toMatchObject({
      preferences: {
        [key]: { revision: 1, value: ["continue", "run the tests"] },
      },
    });
    for (const value of [
      [""],
      [" "],
      Array.from({ length: 51 }, () => "x"),
      ["x".repeat(1_025)],
    ]) {
      expect(
        (await putPreference(harness, key, { expectedRevision: 1, value }))
          .status,
      ).toBe(400);
    }
    expect(
      (await putPreference(harness, key, { expectedRevision: 0, value: [] }))
        .status,
    ).toBe(409);
    expect(await readJson(await resetPreference(harness, key))).toMatchObject({
      key,
      revision: 2,
      value: [],
    });
  });
});
