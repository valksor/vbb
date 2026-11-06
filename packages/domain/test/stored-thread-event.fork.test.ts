import { expect, it } from "vitest";
import { systemThreadInterruptedEventDataSchema } from "../src/thread-events.js";

it("parses unanswered-question interruptions", () => {
  const data = { reason: "question-unanswered" } as const;

  expect(systemThreadInterruptedEventDataSchema.parse(data)).toEqual(data);
});
