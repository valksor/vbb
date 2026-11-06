import { isValidGitBranchName as checkoutContractIsValidGitBranchName } from "bb-checkout-contract/git-branch-name";
import { describe, expect, it } from "vitest";
import { isValidGitBranchName } from "../src/index.js";

const BRANCH_NAME_CASES = [
  "main",
  "feature/login",
  "release-1.2",
  "bb/thr_abc-slug",
  "a/b/c",
  "",
  "   ",
  "-leading-dash",
  "/leading-slash",
  "@",
  "HEAD",
  "ORIG_HEAD",
  "has space",
  "has\ttab",
  "has:colon",
  "has~tilde",
  "has^caret",
  "has?question",
  "has*star",
  "has[bracket",
  "has\\backslash",
  "double..dot",
  "at@{brace",
  "double//slash",
  "trailing/",
  "trailing.",
  ".hidden/start",
  "dir/.hidden",
  "name.lock",
  "dir/name.lock/leaf",
  "ctrl\u0001char",
  "del\u007fchar",
];

describe("git branch name validators", () => {
  it("agrees between the domain and checkout-contract copies", () => {
    for (const name of BRANCH_NAME_CASES) {
      expect(checkoutContractIsValidGitBranchName(name), name).toBe(
        isValidGitBranchName(name),
      );
    }
  });
});
