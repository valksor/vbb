async function rejectWorkBarrierCommand(): Promise<never> {
  throw new Error("work barrier command was not handled by the command router");
}

export const workBarrierCommandHandlers = {
  "work.quiesce": rejectWorkBarrierCommand,
  "work.seal": rejectWorkBarrierCommand,
  "work.unquiesce": rejectWorkBarrierCommand,
};
