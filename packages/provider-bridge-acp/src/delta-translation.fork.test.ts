import { describe, expect, it } from "vitest";
import { threadEventSchema, type ThreadEvent } from "@bb/domain";
import {
  THREAD_DELTA_KEY_SEPARATOR,
  threadDeltaSchema,
} from "@bb/provider-bridge-protocol";
import {
  createDeltaAssembler,
  type DeltaAssembler,
} from "@bb/provider-bridge-protocol/assembler";
import type { ProviderRuntimeEvent } from "@bb/provider-bridge-protocol/bridge-kit";
import {
  ACP_COMPACTION_COMPLETED_METHOD,
  ACP_COMPACTION_STARTED_METHOD,
  ACP_PROMPT_INTERRUPTED_METHOD,
  ACP_TURN_COMPLETED_METHOD,
  ACP_TURN_STARTED_METHOD,
  ACP_UPDATE_METHOD,
} from "./bridge-protocol.js";
import {
  createAcpDeltaTranslator,
  type AcpDeltaTranslator,
} from "./delta-translation.js";
import { resolveAcpDialect } from "./dialect.js";

describe("acp delta translation source assertions", () => {
  const THREAD_ID = "t-acp-translation";
  const ENTROPY = "acp-test";

  interface AcpEquivalenceHarness {
    assembler: DeltaAssembler;
    translator: AcpDeltaTranslator;
    translate(event: ProviderRuntimeEvent): ThreadEvent[];
    openTurnId(): string;
  }

  const SESSION_CWD = "/workspace";

  function createHarness(
    fileCreatedThisTurn?: (path: string) => boolean | undefined,
  ): AcpEquivalenceHarness {
    const translator = createAcpDeltaTranslator({
      cwd: SESSION_CWD,
      fileCreatedThisTurn,
    });
    const assembler = createDeltaAssembler({
      providerId: "acp",
      entropyPrefix: ENTROPY,
      textDeltaFlushMs: 0,
    });
    return {
      assembler,
      translator,
      translate(event) {
        return assembler.assemble({
          threadId: THREAD_ID,
          deltas: translator.translateAcpEvent(event, { threadId: THREAD_ID }),
        });
      },
      openTurnId() {
        return assembler.getOpenTurnId(THREAD_ID) ?? "";
      },
    };
  }

  function turnStartedEvent(): ProviderRuntimeEvent {
    return {
      jsonrpc: "2.0",
      method: ACP_TURN_STARTED_METHOD,
      params: { threadId: THREAD_ID },
    };
  }

  function turnCompletedEvent(stopReason: string): ProviderRuntimeEvent {
    return {
      jsonrpc: "2.0",
      method: ACP_TURN_COMPLETED_METHOD,
      params: { threadId: THREAD_ID, stopReason },
    };
  }

  function updateEvent(update: Record<string, unknown>): ProviderRuntimeEvent {
    return {
      jsonrpc: "2.0",
      method: ACP_UPDATE_METHOD,
      params: { threadId: THREAD_ID, update },
    };
  }

  function completedItems(events: ThreadEvent[]) {
    return events.flatMap((event) =>
      event.type === "item/completed" ? [event.item] : [],
    );
  }

  describe("acp delta translation (dialects)", () => {
    function dialectHarness(dialectId: string): AcpEquivalenceHarness {
      const translator = createAcpDeltaTranslator({
        cwd: "/workspace",
        dialect: resolveAcpDialect({ dialectId, command: "node" }),
      });
      const assembler = createDeltaAssembler({
        providerId: "acp",
        entropyPrefix: ENTROPY,
        textDeltaFlushMs: 0,
      });
      const harness: AcpEquivalenceHarness = {
        assembler,
        translator,
        translate: (event) =>
          assembler.assemble({
            threadId: THREAD_ID,
            deltas: translator.translateAcpEvent(event, { threadId: THREAD_ID }),
          }),
        openTurnId: () => assembler.getOpenTurnId(THREAD_ID) ?? "",
      };
      harness.translate(turnStartedEvent());
      return harness;
    }

    it("keeps the parent ref when a delegation report re-opens a parented call", () => {
      const harness = dialectHarness("cursor");
      const parentOpened = harness.translate(
        updateEvent({
          sessionUpdate: "tool_call",
          toolCallId: "call-agent",
          title: "Agent",
          kind: "other",
          status: "in_progress",
        }),
      );
      const parentItemId =
        parentOpened[0]?.type === "item/started" ? parentOpened[0].item.id : "";
      harness.translate(
        updateEvent({
          sessionUpdate: "tool_call",
          toolCallId: "call-task",
          title: "Task: Subagent task",
          kind: "other",
          status: "pending",
          rawInput: { _toolName: "task" },
          _meta: { claudeCode: { parentToolUseId: "call-agent" } },
        }),
      );

      const reported = harness.assembler.assemble({
        threadId: THREAD_ID,
        deltas: harness.translator.noteDelegationReport(THREAD_ID, {
          toolCallId: "call-task",
          childRef: "child-1",
          label: "Nested task",
        }),
      });

      expect(reported).toEqual([
        expect.objectContaining({
          type: "item/started",
          item: expect.objectContaining({
            type: "delegation",
            childRef: "child-1",
            parentToolCallId: parentItemId,
          }),
        }),
      ]);
    });
  });

  describe("acp delta translation (claude-agent-acp subagent attribution)", () => {
    const AGENT_CALL_ID = "toolu_agent_1";
    const subagentMeta = { claudeCode: { parentToolUseId: AGENT_CALL_ID } };

    function startedHarness(): AcpEquivalenceHarness {
      const harness = createHarness();
      harness.translate(turnStartedEvent());
      return harness;
    }

    function openAgentCall(
      harness: AcpEquivalenceHarness,
      toolCallId: string = AGENT_CALL_ID,
    ): ThreadEvent[] {
      return harness.translate(
        updateEvent({
          sessionUpdate: "tool_call",
          toolCallId,
          title: "Agent",
          kind: "other",
          status: "in_progress",
          rawInput: { description: "Review plan", prompt: "Review the plan" },
        }),
      );
    }

    function subagentToolCall(
      toolCallId: string,
      meta?: Record<string, unknown>,
      status: "in_progress" | "failed" = "in_progress",
    ) {
      return updateEvent({
        sessionUpdate: "tool_call",
        toolCallId,
        title: "ls",
        kind: "execute",
        status,
        rawInput: { command: "ls" },
        ...(meta === undefined ? {} : { _meta: meta }),
      });
    }

    function startedItemId(events: ThreadEvent[]): string | undefined {
      const started = events.find((event) => event.type === "item/started");
      return started?.type === "item/started" ? started.item.id : undefined;
    }

    function parentedChunk(text: string, parentToolUseId: string) {
      return updateEvent({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
        _meta: { claudeCode: { parentToolUseId } },
      });
    }

    function mainChunk(text: string) {
      return updateEvent({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      });
    }

    it("keeps the main assistant message whole across subagent tool calls", () => {
      const harness = startedHarness();
      const events: ThreadEvent[] = [];
      events.push(...openAgentCall(harness));
      events.push(...harness.translate(mainChunk("the plan had")));
      events.push(
        ...harness.translate(subagentToolCall("sub-call-1", subagentMeta)),
      );
      events.push(
        ...harness.translate(
          updateEvent({
            sessionUpdate: "tool_call_update",
            toolCallId: "sub-call-1",
            status: "completed",
            rawOutput: "file.txt",
            _meta: subagentMeta,
          }),
        ),
      );
      events.push(...harness.translate(mainChunk("n't been reviewed")));
      events.push(...harness.translate(turnCompletedEvent("end_turn")));

      const items = completedItems(events);
      const messages = items.filter((item) => item.type === "agentMessage");
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        text: "the plan hadn't been reviewed",
      });
      const agentItem = items.find(
        (item) =>
          item.type !== "agentMessage" && item.type !== "commandExecution",
      );
      expect(agentItem?.parentToolCallId).toBeUndefined();
      const subagentItem = items.find((item) => item.type === "commandExecution");
      expect(subagentItem).toMatchObject({
        parentToolCallId: agentItem?.id,
      });
      expect(subagentItem?.parentToolCallId).toBeDefined();
    });

    it("closes a parented tool call from an update that carries no meta", () => {
      const harness = startedHarness();
      openAgentCall(harness);
      harness.translate(subagentToolCall("sub-call-1", subagentMeta));
      const events = harness.translate(
        updateEvent({
          sessionUpdate: "tool_call_update",
          toolCallId: "sub-call-1",
          status: "completed",
          rawOutput: "file.txt",
        }),
      );
      const completed = completedItems(events);
      expect(completed).toHaveLength(1);
      expect(completed[0]).toMatchObject({ type: "commandExecution" });
      expect(completed[0]?.parentToolCallId).toBeDefined();
    });

    it("routes subagent text to its own message", () => {
      const harness = startedHarness();
      openAgentCall(harness);
      const events: ThreadEvent[] = [];
      events.push(...harness.translate(mainChunk("main text")));
      events.push(
        ...harness.translate(
          updateEvent({
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "subagent text" },
            _meta: subagentMeta,
          }),
        ),
      );
      events.push(...harness.translate(turnCompletedEvent("end_turn")));

      const messages = completedItems(events).filter(
        (item) => item.type === "agentMessage",
      );
      const texts = messages.map((item) => item.text).sort();
      expect(texts).toEqual(["main text", "subagent text"]);
      const child = messages.find((item) => item.text === "subagent text");
      expect(child?.parentToolCallId).toBeDefined();
      const main = messages.find((item) => item.text === "main text");
      expect(main?.parentToolCallId).toBeUndefined();
    });

    it("does not re-key an open call from a self-parented progress beat", () => {
      const harness = startedHarness();
      const events: ThreadEvent[] = [];
      events.push(...openAgentCall(harness));
      events.push(
        ...harness.translate(
          updateEvent({
            sessionUpdate: "tool_call_update",
            toolCallId: AGENT_CALL_ID,
            status: "in_progress",
            _meta: subagentMeta,
          }),
        ),
      );
      events.push(
        ...harness.translate(
          updateEvent({
            sessionUpdate: "tool_call_update",
            toolCallId: AGENT_CALL_ID,
            status: "completed",
            rawOutput: "done",
          }),
        ),
      );

      expect(
        events.filter((event) => event.type === "item/started"),
      ).toHaveLength(1);
      const completed = completedItems(events);
      expect(completed).toHaveLength(1);
      expect(completed[0]?.parentToolCallId).toBeUndefined();
      expect(completed[0]?.id).toBe(startedItemId(events));
    });

    it("keeps a call without a parent unparented when a later update names one", () => {
      const harness = startedHarness();
      const events: ThreadEvent[] = [];
      events.push(...harness.translate(subagentToolCall("main-call")));
      events.push(
        ...harness.translate(
          updateEvent({
            sessionUpdate: "tool_call_update",
            toolCallId: "main-call",
            status: "in_progress",
            _meta: subagentMeta,
          }),
        ),
      );
      events.push(
        ...harness.translate(
          updateEvent({
            sessionUpdate: "tool_call_update",
            toolCallId: "main-call",
            status: "completed",
            rawOutput: "file.txt",
          }),
        ),
      );

      const completed = completedItems(events);
      expect(completed).toHaveLength(1);
      expect(completed[0]?.parentToolCallId).toBeUndefined();
      expect(completed[0]?.id).toBe(startedItemId(events));
    });

    it("completes subagent text when its Agent call completes", () => {
      const harness = startedHarness();
      openAgentCall(harness);
      harness.translate(parentedChunk("subagent text", AGENT_CALL_ID));

      const atCompletion = completedItems(
        harness.translate(
          updateEvent({
            sessionUpdate: "tool_call_update",
            toolCallId: AGENT_CALL_ID,
            status: "completed",
            rawOutput: "done",
          }),
        ),
      );
      expect(atCompletion.map((item) => item.type)).toEqual([
        "agentMessage",
        expect.any(String),
      ]);
      expect(atCompletion[0]).toMatchObject({ text: "subagent text" });
      expect(atCompletion[0]?.parentToolCallId).toBeDefined();

      const rest = [
        ...harness.translate(mainChunk("main text")),
        ...harness.translate(turnCompletedEvent("end_turn")),
      ];
      const messages = completedItems(rest).filter(
        (item) => item.type === "agentMessage",
      );
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ text: "main text" });
      expect(messages[0]?.parentToolCallId).toBeUndefined();
    });

    it("keeps interleaved subagents' messages whole and attributed", () => {
      const harness = startedHarness();
      const events: ThreadEvent[] = [];
      const agentA = openAgentCall(harness, "toolu_agent_a");
      const agentB = openAgentCall(harness, "toolu_agent_b");
      events.push(...agentA, ...agentB);
      events.push(...harness.translate(parentedChunk("a1", "toolu_agent_a")));
      events.push(
        ...harness.translate(
          subagentToolCall("sub-b", {
            claudeCode: { parentToolUseId: "toolu_agent_b" },
          }),
        ),
      );
      events.push(...harness.translate(parentedChunk("a2", "toolu_agent_a")));
      events.push(...harness.translate(mainChunk("m")));
      events.push(...harness.translate(parentedChunk("b1", "toolu_agent_b")));
      events.push(...harness.translate(turnCompletedEvent("end_turn")));

      const messages = completedItems(events).filter(
        (item) => item.type === "agentMessage",
      );
      const byText = new Map(messages.map((item) => [item.text, item]));
      expect([...byText.keys()].sort()).toEqual(["a1a2", "b1", "m"]);
      expect(byText.get("a1a2")?.parentToolCallId).toBe(startedItemId(agentA));
      expect(byText.get("b1")?.parentToolCallId).toBe(startedItemId(agentB));
      expect(byText.get("m")?.parentToolCallId).toBeUndefined();
    });

    it("keeps the main message whole across an already-failed subagent call", () => {
      const harness = startedHarness();
      const events: ThreadEvent[] = [];
      const agent = openAgentCall(harness);
      events.push(...harness.translate(mainChunk("before")));
      events.push(
        ...harness.translate(
          subagentToolCall("sub-failed", subagentMeta, "failed"),
        ),
      );
      events.push(...harness.translate(mainChunk("after")));
      events.push(...harness.translate(turnCompletedEvent("end_turn")));

      const completed = completedItems(events);
      const messages = completed.filter((item) => item.type === "agentMessage");
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ text: "beforeafter" });
      const failed = completed.find((item) => item.type === "commandExecution");
      expect(failed).toMatchObject({ status: "failed" });
      expect(failed?.parentToolCallId).toBe(startedItemId(agent));
    });

    it("still closes the main assistant stream for an unparented tool call", () => {
      const harness = startedHarness();
      const events: ThreadEvent[] = [];
      events.push(...harness.translate(mainChunk("before")));
      events.push(...harness.translate(subagentToolCall("main-call")));
      events.push(...harness.translate(mainChunk("after")));
      events.push(...harness.translate(turnCompletedEvent("end_turn")));

      const messages = completedItems(events).filter(
        (item) => item.type === "agentMessage",
      );
      expect(messages.map((item) => item.text)).toEqual(["before", "after"]);
    });
  });

});

const THREAD_ID = "t-acp-parent-refs";

interface Harness {
  assembler: DeltaAssembler;
  translator: AcpDeltaTranslator;
  translate(event: ProviderRuntimeEvent, threadId?: string): ThreadEvent[];
}

function createHarness(): Harness {
  const translator = createAcpDeltaTranslator({ cwd: "/workspace" });
  const assembler = createDeltaAssembler({
    providerId: "acp",
    entropyPrefix: "acp-parent-refs",
    textDeltaFlushMs: 0,
  });
  return {
    assembler,
    translator,
    translate(event, threadId = THREAD_ID) {
      const deltas = translator.translateAcpEvent(event, { threadId });
      for (const delta of deltas) threadDeltaSchema.parse(delta);
      const events = assembler.assemble({ threadId, deltas });
      for (const assembled of events) {
        threadEventSchema.parse(JSON.parse(JSON.stringify(assembled)));
      }
      return events;
    },
  };
}

function started(threadId = THREAD_ID): ProviderRuntimeEvent {
  return {
    jsonrpc: "2.0",
    method: ACP_TURN_STARTED_METHOD,
    params: { threadId },
  };
}

function completed(
  stopReason: "cancelled" | "end_turn",
  threadId = THREAD_ID,
): ProviderRuntimeEvent {
  return {
    jsonrpc: "2.0",
    method: ACP_TURN_COMPLETED_METHOD,
    params: { threadId, stopReason },
  };
}

function providerError(): ProviderRuntimeEvent {
  return {
    jsonrpc: "2.0",
    method: "error",
    params: { message: "provider failed" },
  };
}

function update(
  update: Record<string, unknown>,
  threadId = THREAD_ID,
): ProviderRuntimeEvent {
  return {
    jsonrpc: "2.0",
    method: ACP_UPDATE_METHOD,
    params: { threadId, update },
  };
}

function parentMeta(parentToolUseId: string): Record<string, unknown> {
  return { claudeCode: { parentToolUseId } };
}

function completedItems(events: ThreadEvent[]) {
  return events.flatMap((event) =>
    event.type === "item/completed" ? [event.item] : [],
  );
}

function startedItemId(events: ThreadEvent[]): string {
  const item = events.find((event) => event.type === "item/started");
  if (item?.type !== "item/started") throw new Error("Expected an item start");
  return item.item.id;
}

function openAgent(harness: Harness, id: string, threadId = THREAD_ID): string {
  return startedItemId(
    harness.translate(
      update(
        {
          sessionUpdate: "tool_call",
          toolCallId: id,
          title: "Agent",
          kind: "other",
          status: "in_progress",
          rawInput: { description: id, prompt: id },
        },
        threadId,
      ),
      threadId,
    ),
  );
}

function openCommand(
  id: string,
  meta?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    sessionUpdate: "tool_call",
    toolCallId: id,
    title: "ls",
    kind: "execute",
    status: "in_progress",
    rawInput: { command: "ls" },
    ...(meta === undefined ? {} : { _meta: meta }),
  };
}

describe("ACP parent references", () => {
  it("keeps root text whole while routing child text and reasoning to the first parent", () => {
    const harness = createHarness();
    harness.translate(started());
    const parentId = openAgent(harness, "agent-a");
    const events = [
      ...harness.translate(
        update({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "root " },
        }),
      ),
      ...harness.translate(
        update(openCommand("child-a", parentMeta("agent-a"))),
      ),
      ...harness.translate(
        update({
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "reasoning" },
          _meta: parentMeta("agent-a"),
        }),
      ),
      ...harness.translate(
        update({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "child" },
          _meta: parentMeta("agent-a"),
        }),
      ),
      ...harness.translate(
        update({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "text" },
          _meta: parentMeta("agent-a"),
        }),
      ),
      ...harness.translate(
        update({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "tail" },
        }),
      ),
      ...harness.translate(completed("end_turn")),
    ];
    const items = completedItems(events);
    expect(items.filter((item) => item.type === "agentMessage")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "root tail" }),
        expect.objectContaining({
          text: "childtext",
          parentToolCallId: parentId,
        }),
      ]),
    );
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "reasoning",
          content: ["reasoning"],
          parentToolCallId: parentId,
        }),
        expect.objectContaining({
          type: "commandExecution",
          parentToolCallId: parentId,
        }),
      ]),
    );
  });

  it("keeps the first parent selection across missing, changed, and self-parented updates", () => {
    const harness = createHarness();
    harness.translate(started());
    const parentA = openAgent(harness, "agent-a");
    openAgent(harness, "agent-b");
    const childStart = harness.translate(
      update(openCommand("child", parentMeta("agent-a"))),
    );
    const childId = startedItemId(childStart);
    const completedChild = completedItems(
      harness.translate(
        update({
          sessionUpdate: "tool_call_update",
          toolCallId: "child",
          status: "completed",
          rawOutput: "done",
          _meta: parentMeta("agent-b"),
        }),
      ),
    )[0];
    expect(completedChild).toMatchObject({
      id: childId,
      parentToolCallId: parentA,
    });

    harness.translate(update(openCommand("self", parentMeta("self"))));
    const self = completedItems(
      harness.translate(
        update({
          sessionUpdate: "tool_call_update",
          toolCallId: "self",
          status: "completed",
          rawOutput: "done",
        }),
      ),
    )[0];
    expect(self?.parentToolCallId).toBeUndefined();
  });

  it("rejects malformed, empty, null, and non-string metadata without inventing parents", () => {
    const invalid = [
      undefined,
      {},
      { claudeCode: {} },
      { claudeCode: { parentToolUseId: "" } },
      { claudeCode: { parentToolUseId: null } },
      { claudeCode: { parentToolUseId: 42 } },
      { claudeCode: { parentToolUseId: `agent${THREAD_DELTA_KEY_SEPARATOR}a` } },
    ];
    for (const [index, meta] of invalid.entries()) {
      const harness = createHarness();
      harness.translate(started());
      harness.translate(update(openCommand(`call-${index}`, meta)));
      const item = completedItems(
        harness.translate(
          update({
            sessionUpdate: "tool_call_update",
            toolCallId: `call-${index}`,
            status: "completed",
            rawOutput: "done",
          }),
        ),
      )[0];
      expect(item?.parentToolCallId).toBeUndefined();
    }
  });

  it("keeps valid parent metadata unchanged beside a reserved separator", () => {
    const harness = createHarness();
    harness.translate(started());
    const parentId = openAgent(harness, "agent-valid");
    const childId = startedItemId(
      harness.translate(
        update(openCommand("child-valid", parentMeta("agent-valid"))),
      ),
    );
    const child = completedItems(
      harness.translate(
        update({
          sessionUpdate: "tool_call_update",
          toolCallId: "child-valid",
          status: "completed",
          rawOutput: "done",
        }),
      ),
    )[0];
    expect(child).toMatchObject({ id: childId, parentToolCallId: parentId });
  });

  it("keeps interleaved root, sibling, and grandchild streams separate", () => {
    const harness = createHarness();
    harness.translate(started());
    const parentA = openAgent(harness, "agent-a");
    const parentB = openAgent(harness, "agent-b");
    const events = [
      ...harness.translate(
        update({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "a1" },
          _meta: parentMeta("agent-a"),
        }),
      ),
      ...harness.translate(
        update({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "root" },
        }),
      ),
      ...harness.translate(
        update({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "b" },
          _meta: parentMeta("agent-b"),
        }),
      ),
      ...harness.translate(
        update({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "a2" },
          _meta: parentMeta("agent-a"),
        }),
      ),
      ...harness.translate(
        update(openCommand("grandchild", parentMeta("agent-a"))),
      ),
      ...harness.translate(completed("end_turn")),
    ];
    const items = completedItems(events);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "agentMessage",
          text: "a1a2",
          parentToolCallId: parentA,
        }),
        expect.objectContaining({
          type: "agentMessage",
          text: "b",
          parentToolCallId: parentB,
        }),
        expect.objectContaining({ type: "agentMessage", text: "root" }),
        expect.objectContaining({
          type: "commandExecution",
          parentToolCallId: parentA,
        }),
      ]),
    );
  });

  it("retains the child item identity through progress, output, completion, and settlement", () => {
    const harness = createHarness();
    harness.translate(started());
    const parentId = openAgent(harness, "agent-a");
    const childId = startedItemId(
      harness.translate(update(openCommand("child", parentMeta("agent-a")))),
    );
    const progress = harness.translate(
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "child",
        status: "in_progress",
        rawOutput: "step",
      }),
    );
    expect(progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "item/commandExecution/outputDelta",
          itemId: childId,
        }),
      ]),
    );
    const child = completedItems(
      harness.translate(
        update({
          sessionUpdate: "tool_call_update",
          toolCallId: "child",
          status: "completed",
          rawOutput: "complete",
        }),
      ),
    )[0];
    expect(child).toMatchObject({ id: childId, parentToolCallId: parentId });
    expect(
      completedItems(harness.translate(completed("cancelled"))).filter(
        (item) => item.id === childId,
      ),
    ).toHaveLength(0);
  });

  it("closes child streams before a parent completes without duplicating completion", () => {
    const harness = createHarness();
    harness.translate(started());
    const parentId = openAgent(harness, "agent-a");
    harness.translate(
      update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "child" },
        _meta: parentMeta("agent-a"),
      }),
    );
    const items = completedItems(
      harness.translate(
        update({
          sessionUpdate: "tool_call_update",
          toolCallId: "agent-a",
          status: "completed",
          rawOutput: "done",
        }),
      ),
    );
    expect(items.map((item) => item.type)).toEqual([
      "agentMessage",
      "toolCall",
    ]);
    expect(items[0]).toMatchObject({
      text: "child",
      parentToolCallId: parentId,
    });
    expect(items.filter((item) => item.type === "agentMessage")).toHaveLength(
      1,
    );
  });

  it("closes parented streams during prompt interruption without waiting for settlement", () => {
    const harness = createHarness();
    harness.translate({
      jsonrpc: "2.0",
      method: ACP_COMPACTION_STARTED_METHOD,
      params: { threadId: THREAD_ID },
    });
    const compactionParent = openAgent(harness, "compact-agent");
    harness.translate(
      update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "compact child" },
        _meta: parentMeta("compact-agent"),
      }),
    );
    const compacted = completedItems(
      harness.translate({
        jsonrpc: "2.0",
        method: ACP_COMPACTION_COMPLETED_METHOD,
        params: { threadId: THREAD_ID, status: "completed" },
      }),
    );
    expect(compacted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "agentMessage",
          text: "compact child",
          parentToolCallId: compactionParent,
        }),
      ]),
    );

    harness.translate(started());
    const interruptedParent = openAgent(harness, "interrupt-agent");
    harness.translate(
      update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "interrupted child" },
        _meta: parentMeta("interrupt-agent"),
      }),
    );
    const interrupted = completedItems(
      harness.translate({
        jsonrpc: "2.0",
        method: ACP_PROMPT_INTERRUPTED_METHOD,
        params: { threadId: THREAD_ID },
      }),
    );
    expect(interrupted.map((item) => item.type)).toEqual([
      "agentMessage",
      "toolCall",
    ]);
    expect(interrupted[0]).toMatchObject({
      text: "interrupted child",
      parentToolCallId: interruptedParent,
    });
    expect(interrupted[1]).toMatchObject({
      id: interruptedParent,
      status: "interrupted",
    });
    const settled = completedItems(harness.translate(completed("cancelled")));
    expect(
      settled.filter((item) => item.parentToolCallId === interruptedParent),
    ).toEqual([]);
  });

  it("flushes child streams and tools before failed provider-error settlement", () => {
    const harness = createHarness();
    harness.translate(started());
    const parentId = openAgent(harness, "error-parent");
    const childId = startedItemId(
      harness.translate(
        update(openCommand("error-child", parentMeta("error-parent"))),
      ),
    );
    harness.translate(
      update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "error text" },
        _meta: parentMeta("error-parent"),
      }),
    );
    harness.translate(
      update({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "error thought" },
        _meta: parentMeta("error-parent"),
      }),
    );
    const events = harness.translate(providerError());
    const items = completedItems(events);
    expect(events.map((event) => event.type)).toEqual([
      "item/completed",
      "item/completed",
      "item/completed",
      "item/completed",
      "provider/error",
      "turn/completed",
    ]);
    expect(items).toEqual([
      expect.objectContaining({
        type: "reasoning",
        content: ["error thought"],
        parentToolCallId: parentId,
      }),
      expect.objectContaining({
        type: "agentMessage",
        text: "error text",
        parentToolCallId: parentId,
      }),
      expect.objectContaining({
        type: "toolCall",
        id: parentId,
        status: "failed",
      }),
      expect.objectContaining({
        type: "commandExecution",
        id: childId,
        parentToolCallId: parentId,
        status: "failed",
      }),
    ]);
    expect(completedItems(harness.translate(completed("end_turn")))).toEqual([]);
  });

  it("flushes root streams and tools before failed provider-error settlement", () => {
    const harness = createHarness();
    harness.translate(started());
    const commandId = startedItemId(
      harness.translate(update(openCommand("root-error"))),
    );
    harness.translate(
      update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "root error" },
      }),
    );
    const items = completedItems(harness.translate(providerError()));
    expect(items).toEqual([
      expect.objectContaining({
        type: "agentMessage",
        text: "root error",
      }),
      expect.objectContaining({
        type: "commandExecution",
        id: commandId,
        status: "failed",
      }),
    ]);
    expect(items.every((item) => item.parentToolCallId === undefined)).toBe(true);
  });

  it("flushes unfinished child work before a new turn and resets provider parent state", () => {
    const harness = createHarness();
    harness.translate(started());
    const oldParentId = openAgent(harness, "reused-parent");
    const oldChildId = startedItemId(
      harness.translate(
        update(openCommand("reused-child", parentMeta("reused-parent"))),
      ),
    );
    harness.translate(
      update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "old child" },
        _meta: parentMeta("reused-parent"),
      }),
    );
    const reset = completedItems(harness.translate(started()));
    expect(reset.map((item) => item.type)).toEqual([
      "agentMessage",
      "toolCall",
      "commandExecution",
    ]);
    expect(reset).toEqual([
      expect.objectContaining({
        text: "old child",
        parentToolCallId: oldParentId,
      }),
      expect.objectContaining({ id: oldParentId, status: "interrupted" }),
      expect.objectContaining({
        id: oldChildId,
        parentToolCallId: oldParentId,
        status: "interrupted",
      }),
    ]);
    const newChildId = startedItemId(
      harness.translate(update(openCommand("reused-child"))),
    );
    const newChild = completedItems(
      harness.translate(
        update({
          sessionUpdate: "tool_call_update",
          toolCallId: "reused-child",
          status: "completed",
          rawOutput: "new",
        }),
      ),
    )[0];
    expect(newChild).toMatchObject({ id: newChildId });
    expect(newChild?.parentToolCallId).toBeUndefined();
  });

  it("flushes unfinished child work before compaction starts", () => {
    const harness = createHarness();
    harness.translate(started());
    const parentId = openAgent(harness, "compaction-parent");
    const childId = startedItemId(
      harness.translate(
        update(openCommand("compaction-child", parentMeta("compaction-parent"))),
      ),
    );
    harness.translate(
      update({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "compaction thought" },
        _meta: parentMeta("compaction-parent"),
      }),
    );
    const items = completedItems(
      harness.translate({
        jsonrpc: "2.0",
        method: ACP_COMPACTION_STARTED_METHOD,
        params: { threadId: THREAD_ID },
      }),
    );
    expect(items).toEqual([
      expect.objectContaining({
        type: "reasoning",
        content: ["compaction thought"],
        parentToolCallId: parentId,
      }),
      expect.objectContaining({ id: parentId, status: "interrupted" }),
      expect.objectContaining({
        id: childId,
        parentToolCallId: parentId,
        status: "interrupted",
      }),
    ]);
  });

  it("flushes root work before turn and compaction resets", () => {
    const harness = createHarness();
    harness.translate(started());
    const turnCommandId = startedItemId(
      harness.translate(update(openCommand("root-turn"))),
    );
    harness.translate(
      update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "root turn" },
      }),
    );
    const turnReset = completedItems(harness.translate(started()));
    expect(turnReset).toEqual([
      expect.objectContaining({ type: "agentMessage", text: "root turn" }),
      expect.objectContaining({
        id: turnCommandId,
        status: "interrupted",
      }),
    ]);
    expect(turnReset.every((item) => item.parentToolCallId === undefined)).toBe(
      true,
    );

    const compactionCommandId = startedItemId(
      harness.translate(update(openCommand("root-compaction"))),
    );
    harness.translate(
      update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "root compaction" },
      }),
    );
    const compactionReset = completedItems(
      harness.translate({
        jsonrpc: "2.0",
        method: ACP_COMPACTION_STARTED_METHOD,
        params: { threadId: THREAD_ID },
      }),
    );
    expect(compactionReset).toEqual([
      expect.objectContaining({
        type: "agentMessage",
        text: "root compaction",
      }),
      expect.objectContaining({
        id: compactionCommandId,
        status: "interrupted",
      }),
    ]);
    expect(
      compactionReset.every((item) => item.parentToolCallId === undefined),
    ).toBe(true);
  });

  it("preserves parent identity when a Cursor delegation report reopens an item", () => {
    const translator = createAcpDeltaTranslator({
      cwd: "/workspace",
      dialect: resolveAcpDialect({ dialectId: "cursor", command: "node" }),
    });
    const assembler = createDeltaAssembler({
      providerId: "acp",
      entropyPrefix: "cursor-parent",
      textDeltaFlushMs: 0,
    });
    const translate = (event: ProviderRuntimeEvent) => {
      const deltas = translator.translateAcpEvent(event, { threadId: THREAD_ID });
      for (const delta of deltas) threadDeltaSchema.parse(delta);
      const events = assembler.assemble({ threadId: THREAD_ID, deltas });
      for (const event of events) {
        threadEventSchema.parse(JSON.parse(JSON.stringify(event)));
      }
      return events;
    };
    translate(started());
    const parent = startedItemId(
      translate(
        update({
          sessionUpdate: "tool_call",
          toolCallId: "agent",
          title: "Agent",
          kind: "other",
          status: "in_progress",
        }),
      ),
    );
    translate(
      update({
        sessionUpdate: "tool_call",
        toolCallId: "task",
        title: "Task: inspect",
        kind: "other",
        status: "pending",
        rawInput: { _toolName: "task" },
        _meta: parentMeta("agent"),
      }),
    );
    const events = assembler.assemble({
      threadId: THREAD_ID,
      deltas: translator.noteDelegationReport(THREAD_ID, {
        toolCallId: "task",
        childRef: "child",
        label: "Inspect",
      }),
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: expect.objectContaining({
            type: "delegation",
            parentToolCallId: parent,
            childRef: "child",
          }),
        }),
      ]),
    );
  });

  it("isolates parent stream tracking by thread and permits provider-id reuse after settlement", () => {
    const harness = createHarness();
    harness.translate(started("thread-a"), "thread-a");
    harness.translate(started("thread-b"), "thread-b");
    const parentA = openAgent(harness, "agent", "thread-a");
    harness.translate(
      update(
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "a" },
          _meta: parentMeta("agent"),
        },
        "thread-a",
      ),
      "thread-a",
    );
    harness.translate(
      update(
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "b" },
        },
        "thread-b",
      ),
      "thread-b",
    );
    const second = completedItems(
      harness.translate(completed("end_turn", "thread-b"), "thread-b"),
    );
    expect(second).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: "b" })]),
    );
    expect(
      second.find((item) => item.type === "agentMessage")?.parentToolCallId,
    ).toBeUndefined();
    const first = completedItems(
      harness.translate(completed("end_turn", "thread-a"), "thread-a"),
    );
    expect(first).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "a", parentToolCallId: parentA }),
      ]),
    );
    harness.translate(started("thread-b"), "thread-b");
    const reusedId = startedItemId(
      harness.translate(update(openCommand("agent"), "thread-b"), "thread-b"),
    );
    const reused = completedItems(
      harness.translate(
        update(
          {
            sessionUpdate: "tool_call_update",
            toolCallId: "agent",
            status: "completed",
            rawOutput: "done",
          },
          "thread-b",
        ),
        "thread-b",
      ),
    )[0];
    expect(reused).toMatchObject({ id: reusedId });
    expect(reused?.parentToolCallId).toBeUndefined();
  });
});
