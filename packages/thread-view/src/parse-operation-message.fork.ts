export function stalledTurnDisplay(decoded: { action: string }): {
  title: string;
  status: "error" | "completed";
} {
  const interrupting = decoded.action === "interrupt";
  return {
    title: interrupting
      ? "Provider turn stopped responding, interrupting turn"
      : "Provider turn stopped responding",
    status: interrupting ? "error" : "completed",
  };
}
