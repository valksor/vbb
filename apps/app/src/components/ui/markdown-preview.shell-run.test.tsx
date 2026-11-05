// @vitest-environment jsdom

import { LazyMarkdownHtml } from "./lazy-markdown-html";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./markdown-preview";
import { ShellRunMarkdownPreview } from "@/components/thread/timeline/ConversationMessageContent.fork";
import { ShellCommandRunnerSourceProvider } from "./markdown-shell-command-run.fork";
import { OPEN_IN_TARGET_COMMAND_MAX_LENGTH } from "@bb/host-daemon-contract";

beforeAll(() => LazyMarkdownHtml.preload());

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderMarkdownWithRunner(
  content: string,
  shellCommandRunner:
    | ((code: string, language: string) => void)
    | null = vi.fn(),
) {
  return render(
    <ShellCommandRunnerSourceProvider runner={shellCommandRunner}>
      <ShellRunMarkdownPreview shellRun content={content} />
    </ShellCommandRunnerSourceProvider>,
  );
}

const BASH_BLOCK = "```bash\nnpm run build\n```";

describe("MarkdownPreview shell command run button", () => {
  it.each(["bash", "sh", "zsh", "shell"])(
    "shows the run button for a %s block with the language in its accessible name",
    (language) => {
      renderMarkdownWithRunner(`\`\`\`${language}\nnpm run build\n\`\`\``);

      expect(
        screen.queryByRole("button", {
          name: `Run in terminal (${language})`,
        }),
      ).not.toBeNull();
    },
  );

  it.each([
    ["json", '```json\n{"a": 1}\n```'],
    ["console", "```console\n$ npm run build\n```"],
    ["ansi", "```ansi\n\x1b[31merror\x1b[0m\n```"],
    ["output", "```output\nBUILD SUCCESS\n```"],
    ["fish", "```fish\nabbr -a gco git checkout\n```"],
    ["untagged", "```\nnpm run build\n```"],
  ])("hides the run button for a %s block", (_language, content) => {
    renderMarkdownWithRunner(content);

    expect(
      screen.queryByRole("button", { name: /^Run in terminal/u }),
    ).toBeNull();
  });

  it("hides the run button when the runner is null", () => {
    renderMarkdownWithRunner(BASH_BLOCK, null);

    expect(
      screen.queryByRole("button", { name: /^Run in terminal/u }),
    ).toBeNull();
  });

  it("hides the run button when the runner is omitted", () => {
    render(<MarkdownPreview content={BASH_BLOCK} />);

    expect(
      screen.queryByRole("button", { name: /^Run in terminal/u }),
    ).toBeNull();
  });

  it("re-renders and shows the run button when the runner arrives late", () => {
    const { rerender } = render(
      <ShellCommandRunnerSourceProvider runner={null}>
        <ShellRunMarkdownPreview shellRun content={BASH_BLOCK} />
      </ShellCommandRunnerSourceProvider>,
    );

    expect(
      screen.queryByRole("button", { name: /^Run in terminal/u }),
    ).toBeNull();

    const runner = vi.fn();
    rerender(
      <ShellCommandRunnerSourceProvider runner={runner}>
        <ShellRunMarkdownPreview shellRun content={BASH_BLOCK} />
      </ShellCommandRunnerSourceProvider>,
    );

    expect(
      screen.queryByRole("button", { name: "Run in terminal (bash)" }),
    ).not.toBeNull();
  });

  it("invokes the runner with the exact code text and language", () => {
    const runner = vi.fn();
    const codeText = "echo 'a && b'\nnpm run build";
    render(
      <ShellCommandRunnerSourceProvider runner={runner}>
        <ShellRunMarkdownPreview
          shellRun
          content={`\`\`\`bash\n${codeText}\n\`\`\``}
        />
      </ShellCommandRunnerSourceProvider>,
    );

    const runButton = screen.getByRole("button", {
      name: "Run in terminal (bash)",
    });
    fireEvent.click(runButton);

    expect(runner).toHaveBeenCalledWith(codeText, "bash");
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("hides the run button for an empty-after-trim block", () => {
    renderMarkdownWithRunner("```bash\n   \n\t\n```");

    expect(
      screen.queryByRole("button", { name: /^Run in terminal/u }),
    ).toBeNull();
  });

  it("hides the run button for a comment-only block", () => {
    renderMarkdownWithRunner("```bash\n# setup only\n   # nothing to run\n```");

    expect(
      screen.queryByRole("button", { name: /^Run in terminal/u }),
    ).toBeNull();
  });

  it("hides the run button for a block over the shared command cap", () => {
    const longCommand = `echo ${"a".repeat(OPEN_IN_TARGET_COMMAND_MAX_LENGTH)}`;
    renderMarkdownWithRunner(`\`\`\`bash\n${longCommand}\n\`\`\``);

    expect(
      screen.queryByRole("button", { name: /^Run in terminal/u }),
    ).toBeNull();
  });

  it("hides the run button for a block one character over the shared command cap", () => {
    const command = "a".repeat(OPEN_IN_TARGET_COMMAND_MAX_LENGTH + 1);
    renderMarkdownWithRunner(`\`\`\`sh\n${command}\n\`\`\``);

    expect(
      screen.queryByRole("button", { name: /^Run in terminal/u }),
    ).toBeNull();
  });
});
