import type { CommandGroup, CommandGroupRegistrar } from "./command-groups.js";

function group<Module>(
  name: string,
  load: () => Promise<Module>,
  register: (module: Module) => CommandGroupRegistrar,
): CommandGroup {
  return { name, load: () => load().then(register) };
}

const MAINTENANCE_GROUP = group(
  "maintenance",
  () => import("./commands/maintenance.js"),
  (m) => (program) => m.registerMaintenanceCommands(program),
);

const SPEND_GROUP = group(
  "spend",
  () => import("./commands/spend.js"),
  (m) => (program, deps) => m.registerSpendCommands(program, deps.getUrl),
);

const RUN_IN_TERMINAL_GROUP = group(
  "run-in-terminal",
  () => import("./commands/run-in-terminal.js"),
  (m) => (program, deps) =>
    m.registerRunInTerminalCommand(program, deps.getUrl),
);

function insertAfter(
  groups: readonly CommandGroup[],
  anchor: string,
  entry: CommandGroup,
): CommandGroup[] {
  const index = groups.findIndex((candidate) => candidate.name === anchor);
  if (index === -1) {
    throw new Error(`Cannot place fork command group after "${anchor}".`);
  }
  return [...groups.slice(0, index + 1), entry, ...groups.slice(index + 1)];
}

export function withForkCommandGroups(
  coreGroups: readonly CommandGroup[],
): readonly CommandGroup[] {
  return insertAfter(
    [MAINTENANCE_GROUP, SPEND_GROUP, ...coreGroups],
    "terminal",
    RUN_IN_TERMINAL_GROUP,
  );
}
