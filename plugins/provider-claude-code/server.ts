import { registerUsageSource } from "./src/usage-source.js";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { claudeCodeProviderDeclaration } from "./src/declaration.js";
import {
  CLAUDE_CODE_PROFILES_SETTING,
  registerClaudeCodeProfiles,
} from "./src/server-profiles.js";

export default async function plugin(bb: BbPluginApi): Promise<void> {
  registerUsageSource(bb);
  const settings = bb.settings.define({
    memoryEnabled: {
      type: "boolean",
      label: "Claude Code memory",
      description:
        "Allow Claude Code to read and write its native auto-memory for bb threads.",
      default: true,
    },
    subagentsDisabled: {
      type: "boolean",
      label: "Disable provider subagents",
      description:
        "Hide Claude Code's native subagent tools so agents use bb for delegation. Changes restart Claude before the next turn, preserving the conversation.",
      default: false,
    },
    workflowsDisabled: {
      type: "boolean",
      label: "Disable Workflow tool",
      description: "Hide Claude Code's native Workflow tool for bb threads.",
      default: false,
    },
    disable1MContext: {
      type: "boolean",
      label: "Disable 1M context",
      description:
        "Disable the 1M-token context window for Claude Code threads. Applies on the next turn.",
      default: false,
    },
    chromeEnabled: {
      type: "boolean",
      label: "Claude in Chrome",
      description:
        "Start Claude Code with the Claude in Chrome browser tools. Needs the Chrome extension and a claude.ai login on the host.",
      default: false,
    },
    artifactsEnabled: {
      type: "boolean",
      label: "Claude Artifacts",
      description:
        "Give Claude Code its Artifact tools to read, publish, and edit claude.ai artifacts. Claude may publish private pages to claude.ai without asking. Needs a claude.ai login on the host. Applies on the next turn.",
      default: false,
    },
    sandboxEnabled: {
      type: "boolean",
      label: "Claude Code sandbox",
      description:
        "Run Bash commands in Claude Code's sandbox in Accept Edits and Approve for me modes. Turn off to use Claude Code's own command approvals and sandbox settings instead.",
      default: true,
    },
    fullAccessApprovalsEnabled: {
      type: "boolean",
      label: "Approvals in Full Access",
      description:
        "Show Claude Code's own approval prompts in Full Access: permissions.ask rules, PreToolUse hooks that answer ask, and Claude Code's built-in safety checks. Off approves every request, so unattended threads never wait. Applies on the next turn.",
      default: false,
    },
    commandDescriptionsEnabled: {
      type: "boolean",
      label: "Command descriptions",
      description:
        "Title Bash command rows with Claude's short description of the command instead of the command itself. Approval prompts still show the command. Takes effect from each thread's next message; existing rows keep their titles.",
      default: false,
    },
    ...CLAUDE_CODE_PROFILES_SETTING,
  });

  bb.providers.register(claudeCodeProviderDeclaration());

  await registerClaudeCodeProfiles(bb, settings);
}
