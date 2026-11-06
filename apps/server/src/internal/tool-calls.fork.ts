import type { EnvironmentRow } from "@bb/db";
import type { Thread, ToolCallResponse } from "@bb/domain";
import {
  ENTER_BRANCH_TOOL_NAME,
  handleEnterBranchToolCall,
} from "../services/threads/thread-environment-branch.fork.js";
import {
  ENTER_WORKTREE_TOOL_NAME,
  handleEnterWorktreeToolCall,
  handleKeepCheckoutToolCall,
  KEEP_CHECKOUT_TOOL_NAME,
} from "../services/threads/thread-environment-directory.fork.js";
import type { AppDeps } from "../types.js";

export async function invokeForkEnvironmentTool(
  deps: AppDeps,
  tool: string,
  input: unknown,
  args: {
    currentEnvironment: EnvironmentRow;
    thread: Thread;
    turnId: string;
    signal: AbortSignal;
  },
): Promise<ToolCallResponse | null> {
  if (tool === ENTER_BRANCH_TOOL_NAME)
    return handleEnterBranchToolCall(deps, { ...args, input });
  if (tool === ENTER_WORKTREE_TOOL_NAME) {
    return handleEnterWorktreeToolCall(deps, { ...args, input });
  }
  if (tool === KEEP_CHECKOUT_TOOL_NAME) {
    return handleKeepCheckoutToolCall(deps, { ...args, input });
  }
  return null;
}
