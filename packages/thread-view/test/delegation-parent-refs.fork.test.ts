import { describe, expect, it } from "vitest";
import {
  createTimelineEventFactory,
  renderTimelineFixture,
  workRowsOfKind,
} from "./timeline-test-harness.js";

function withParent<T extends { data: { item: object } }>(
  event: T,
  parentToolCallId: string,
) {
  return {
    ...event,
    data: {
      ...event.data,
      item: { ...event.data.item, parentToolCallId },
    },
  };
}

describe("delegation parent references", () => {
  it("recursively owns same-turn Agent children without duplicating child messages at root", () => {
    const event = createTimelineEventFactory({
      threadId: "thread-parent-refs",
      providerThreadId: "provider-parent-refs",
      turnId: "turn-parent-refs",
    });
    const timeline = renderTimelineFixture({
      events: [
        event.turnStarted(),
        event.toolCallStarted({
          itemId: "agent-a",
          tool: "Agent",
          arguments: { prompt: "A" },
        }),
        event.reasoningCompleted({
          itemId: "reasoning-a",
          parentToolCallId: "agent-a",
          text: "same reasoning",
        }),
        event.assistantCompleted({
          itemId: "text-a",
          parentToolCallId: "agent-a",
          text: "same text",
        }),
        withParent(
          event.toolCallStarted({
            itemId: "agent-b",
            tool: "Agent",
            arguments: { prompt: "B" },
          }),
          "agent-a",
        ),
        event.assistantCompleted({
          itemId: "text-b",
          parentToolCallId: "agent-b",
          text: "nested text",
        }),
        withParent(
          event.toolCallCompleted({
            itemId: "agent-b",
            tool: "Agent",
            arguments: { prompt: "B" },
          }),
          "agent-a",
        ),
        event.toolCallStarted({
          itemId: "agent-c",
          tool: "Agent",
          arguments: { prompt: "C" },
        }),
        event.assistantCompleted({
          itemId: "text-c",
          parentToolCallId: "agent-c",
          text: "same text",
        }),
        event.toolCallCompleted({
          itemId: "agent-a",
          tool: "Agent",
          arguments: { prompt: "A" },
        }),
        event.toolCallCompleted({
          itemId: "agent-c",
          tool: "Agent",
          arguments: { prompt: "C" },
        }),
        event.assistantCompleted({ itemId: "root-text", text: "same text" }),
        event.turnCompleted(),
      ],
      projectionOptions: { threadStatus: "idle", turnMessageDetail: "summary" },
    });
    const delegations = workRowsOfKind(timeline.rows, "delegation");
    const rootMessages = timeline.rows.filter(
      (row) => row.kind === "conversation",
    );
    const parentA = delegations.find((row) => row.callId === "agent-a");
    const parentB = parentA?.childRows?.find(
      (row) =>
        row.kind === "work" &&
        row.workKind === "delegation" &&
        row.callId === "agent-b",
    );
    const parentC = delegations.find((row) => row.callId === "agent-c");

    expect(delegations.map((row) => row.callId).sort()).toEqual([
      "agent-a",
      "agent-b",
      "agent-c",
    ]);
    expect(parentA?.childRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "conversation", text: "same text" }),
        expect.objectContaining({ kind: "work", callId: "agent-b" }),
      ]),
    );
    expect(parentB).toEqual(
      expect.objectContaining({
        childRows: expect.arrayContaining([
          expect.objectContaining({
            kind: "conversation",
            text: "nested text",
          }),
        ]),
      }),
    );
    expect(parentC?.childRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "conversation", text: "same text" }),
      ]),
    );
    expect(rootMessages).toEqual([
      expect.objectContaining({ text: "same text" }),
    ]);
  });
});
