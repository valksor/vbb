export function resolvedSessionSettings(params) {
  return {
    model: params.model ?? "fake-codex-model",
    modelProvider: "openai",
    serviceTier: params.serviceTier ?? null,
    approvalPolicy: params.approvalPolicy ?? "on-request",
    approvalsReviewer: params.approvalsReviewer ?? "user",
    sandbox:
      params.sandbox === "workspace-write"
        ? { type: "workspaceWrite" }
        : params.sandbox === "read-only"
          ? { type: "readOnly" }
          : { type: "dangerFullAccess" },
    reasoningEffort: "medium",
  };
}
