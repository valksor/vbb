import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  experimental_ProviderIcon as ProviderIcon,
  experimental_usePluginId,
  experimental_useSidebarThreads,
  type PluginAppSetup,
  type PluginComposerAsideProps,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { usageBarColorClass } from "./usage-format.js";
import {
  offlineUsageMessage,
  usageFeedbackMessages,
} from "./usage-feedback.js";
import {
  UsageSkeleton,
  accountStatusMessage,
  formatResetCountdown,
  shortWindowLabel,
  usageToneTextClass,
} from "./usage-shared.fork.js";
import {
  CARD_MAX_AGE_MS,
  FOCUS_MAX_AGE_MS,
  fetchUsageSnapshot,
} from "./usage-client.fork.js";
import type {
  UsageMachine,
  UsageProvider,
  UsageSnapshot,
} from "./usage-schema.js";

const ASIDE_MOUNT_DEBOUNCE_MS = 300;
const ASIDE_RESET_DELAY_MS = 60_000;
const ASIDE_MAX_KEYS = 16;

interface AsideEntry {
  pluginId: string;
  machineIds: string[];
  data: UsageSnapshot | null;
  lastRequestAt: number | null;
  lastSuccessAt: number | null;
  lastRequestFailedAt: number | null;
  firedResets: Set<string>;
  union: Set<string>;
  primed: boolean;
  subscribers: Map<object, string[]>;
  mountTimer: number | null;
  controller: AbortController | null;
}

const asideEntries = new Map<string, AsideEntry>();
let asideMachines: UsageMachine[] | null = null;
let asideCardSnapshotSource: (() => UsageSnapshot | null) | null = null;
const asideListeners = new Set<() => void>();
let asideVersion = 0;
let asideTicker: number | null = null;
let asideInstanceSequence = 0;

export function setAsideCardSnapshotSource(
  read: () => UsageSnapshot | null,
): void {
  asideCardSnapshotSource = read;
}

export function noteAsideCardSnapshot(snapshot: UsageSnapshot): void {
  asideMachines = snapshot.machines;
  notifyAside();
}

function asideMachinesForSeed(): UsageMachine[] | null {
  const snapshot = asideCardSnapshotSource?.() ?? null;
  return asideMachines ?? snapshot?.machines ?? null;
}

function notifyAside(): void {
  asideVersion += 1;
  for (const listener of asideListeners) listener();
}

function subscribeAsideStore(listener: () => void): () => void {
  asideListeners.add(listener);
  return () => asideListeners.delete(listener);
}

function getAsideVersion(): number {
  return asideVersion;
}

export function clearAsideFailures(machineIds: string[] | null): void {
  let changed = false;
  for (const entry of asideEntries.values()) {
    if (entry.lastRequestFailedAt === null) continue;
    if (
      machineIds !== null &&
      !machineIds.some((id) => entry.machineIds.includes(id))
    )
      continue;
    entry.lastRequestFailedAt = null;
    changed = true;
  }
  if (changed) notifyAside();
}

function asideKeyMachineError(entry: AsideEntry): boolean {
  return (entry.data?.machines ?? []).some(
    (machine) =>
      entry.machineIds.includes(machine.id) && machine.error !== null,
  );
}

function touchAsideEntry(
  key: string,
  pluginId: string,
  machineIds: string[],
): AsideEntry {
  const existing = asideEntries.get(key);
  if (existing !== undefined) {
    asideEntries.delete(key);
    asideEntries.set(key, existing);
    return existing;
  }
  const entry: AsideEntry = {
    pluginId,
    machineIds,
    data: null,
    lastRequestAt: null,
    lastSuccessAt: null,
    lastRequestFailedAt: null,
    firedResets: new Set(),
    union: new Set(),
    primed: false,
    subscribers: new Map(),
    mountTimer: null,
    controller: null,
  };
  asideEntries.set(key, entry);
  if (asideEntries.size > ASIDE_MAX_KEYS) {
    for (const [oldKey, oldEntry] of asideEntries) {
      if (oldEntry.subscribers.size > 0) continue;
      asideEntries.delete(oldKey);
      if (asideEntries.size <= ASIDE_MAX_KEYS) break;
    }
  }
  return entry;
}

function asideUnionOf(entry: AsideEntry): string[] {
  return [...new Set([...entry.subscribers.values()].flat())].sort();
}

function asideSourceIds(): string[] {
  const machines = asideMachinesForSeed();
  if (machines === null) return [];
  return [
    ...new Set(
      machines
        .filter((machine) => machine.id.startsWith("source:"))
        .map((machine) => machine.id),
    ),
  ].sort();
}

function asideSourceMachineId(providerId: string): string | null {
  const machines = asideMachinesForSeed();
  if (machines === null) return null;
  for (const machine of machines) {
    if (!machine.id.startsWith("source:")) continue;
    if (
      machine.providers.some((provider) => provider.providerId === providerId)
    )
      return machine.id;
  }
  return null;
}

function refreshVisibleAsides(): void {
  for (const key of [...asideEntries.keys()]) maybeRefreshAside(key);
}

function ensureAsideTicker(): void {
  if (asideTicker !== null) return;
  asideTicker = window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    refreshVisibleAsides();
  }, 60_000);
  window.addEventListener("focus", refreshVisibleAsides);
}

function stopAsideTicker(): void {
  if (asideTicker === null) return;
  window.clearInterval(asideTicker);
  asideTicker = null;
  window.removeEventListener("focus", refreshVisibleAsides);
}

function dueAsideWindowReset(
  provider: UsageProvider,
  now: number,
  firedResets: Set<string>,
): string | null {
  if (provider.usage?.status !== "ok") return null;
  for (const window of provider.usage.windows) {
    if (window.resetsAt === null || firedResets.has(window.resetsAt)) continue;
    const resetAt = new Date(window.resetsAt).getTime();
    if (Number.isFinite(resetAt) && now >= resetAt + ASIDE_RESET_DELAY_MS)
      return window.resetsAt;
  }
  return null;
}

function nextDueAsideReset(entry: AsideEntry, now: number): string | null {
  for (const machine of entry.data?.machines ?? []) {
    if (!entry.machineIds.includes(machine.id)) continue;
    for (const provider of machine.providers) {
      const resetsAt = dueAsideWindowReset(provider, now, entry.firedResets);
      if (resetsAt !== null) return resetsAt;
    }
  }
  return null;
}

function maybeRefreshAside(key: string): void {
  const entry = asideEntries.get(key);
  if (entry === undefined || entry.subscribers.size === 0) return;
  const now = Date.now();
  const inBackoff =
    entry.lastRequestFailedAt !== null || asideKeyMachineError(entry);
  if (!inBackoff && entry.data !== null) {
    const resetsAt = nextDueAsideReset(entry, now);
    if (resetsAt !== null) {
      entry.firedResets.add(resetsAt);
      void requestAsideSnapshot(key, 0);
      return;
    }
  }
  const wait = inBackoff ? FOCUS_MAX_AGE_MS : CARD_MAX_AGE_MS;
  if (now - (entry.lastRequestAt ?? 0) < wait) return;
  void requestAsideSnapshot(key, CARD_MAX_AGE_MS);
}

async function requestAsideSnapshot(
  key: string,
  maxAgeMs: number,
): Promise<void> {
  const entry = asideEntries.get(key);
  if (entry === undefined || entry.subscribers.size === 0) return;
  const providerIds = asideUnionOf(entry);
  entry.union = new Set(providerIds);
  entry.primed = true;
  entry.lastRequestAt = Date.now();
  const controller = new AbortController();
  entry.controller?.abort();
  entry.controller = controller;
  try {
    const result = await fetchUsageSnapshot({
      pluginId: entry.pluginId,
      force: false,
      machineIds: entry.machineIds,
      maxAgeMs,
      providerIds,
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    entry.data = result;
    entry.lastSuccessAt = Date.now();
    entry.lastRequestFailedAt = null;
    asideMachines = result.machines;
  } catch {
    if (controller.signal.aborted) return;
    entry.lastRequestFailedAt = Date.now();
  } finally {
    if (entry.controller === controller) entry.controller = null;
    notifyAside();
  }
}

function subscribeAsideInstance(
  key: string,
  pluginId: string,
  machineIds: string[],
  instance: object,
  providerIds: string[],
): void {
  const entry = touchAsideEntry(key, pluginId, machineIds);
  const wasEmpty = entry.subscribers.size === 0;
  if (wasEmpty) ensureAsideTicker();
  entry.subscribers.set(instance, providerIds);
  const union = asideUnionOf(entry);
  const grew = union.some((id) => !entry.union.has(id));
  entry.union = new Set(union);
  if (
    grew &&
    entry.primed &&
    entry.lastRequestFailedAt === null &&
    !asideKeyMachineError(entry)
  ) {
    if (entry.mountTimer !== null) {
      window.clearTimeout(entry.mountTimer);
      entry.mountTimer = null;
    }
    void requestAsideSnapshot(key, CARD_MAX_AGE_MS);
    return;
  }
  if (!wasEmpty) return;
  if (entry.mountTimer !== null) window.clearTimeout(entry.mountTimer);
  entry.mountTimer = window.setTimeout(() => {
    entry.mountTimer = null;
    maybeRefreshAside(key);
  }, ASIDE_MOUNT_DEBOUNCE_MS);
}

function unsubscribeAsideInstance(key: string, instance: object): void {
  const entry = asideEntries.get(key);
  if (entry === undefined) return;
  entry.subscribers.delete(instance);
  if (entry.subscribers.size > 0) {
    entry.union = new Set(asideUnionOf(entry));
    return;
  }
  if (entry.mountTimer !== null) {
    window.clearTimeout(entry.mountTimer);
    entry.mountTimer = null;
  }
  entry.controller?.abort();
  entry.controller = null;
  let othersSubscribed = false;
  for (const other of asideEntries.values())
    if (other.subscribers.size > 0) othersSubscribed = true;
  if (othersSubscribed) return;
  stopAsideTicker();
}

export interface AsidePair {
  key: string;
  threadId: string;
  hostId: string;
  hostName: string | null;
  providerId: string;
  isCurrent: boolean;
}

function asideFrontierChildren(
  threads: readonly PluginSidebarThread[],
  parentId: string,
  visited: Set<string>,
): PluginSidebarThread[] {
  const children: PluginSidebarThread[] = [];
  for (const thread of threads) {
    if (thread.parentThreadId !== parentId) continue;
    if (thread.originKind === "fork") continue;
    if (visited.has(thread.id)) continue;
    visited.add(thread.id);
    children.push(thread);
  }
  return children;
}

function asideDescendantPairs(
  threads: readonly PluginSidebarThread[],
  threadId: string,
  addPair: (thread: PluginSidebarThread) => void,
): void {
  const visited = new Set<string>([threadId]);
  let frontier = [threadId];
  while (frontier.length > 0) {
    const next: PluginSidebarThread[] = [];
    for (const parentId of frontier)
      for (const thread of asideFrontierChildren(threads, parentId, visited)) {
        addPair(thread);
        next.push(thread);
      }
    frontier = next.map((thread) => thread.id);
  }
}

function collectAsidePairs(
  threads: readonly PluginSidebarThread[],
  threadId: string,
): AsidePair[] {
  const current = threads.find((thread) => thread.id === threadId);
  if (current === undefined || current.isArchived) return [];
  const pairs: AsidePair[] = [];
  const seenPairs = new Set<string>();
  const addPair = (thread: PluginSidebarThread): void => {
    if (thread.host === null) return;
    const pairKey = `${thread.host.id}\n${thread.providerId}`;
    if (seenPairs.has(pairKey)) return;
    seenPairs.add(pairKey);
    pairs.push({
      key: pairKey,
      threadId: thread.id,
      hostId: thread.host.id,
      hostName: thread.host.name,
      providerId: thread.providerId,
      isCurrent: thread.id === threadId,
    });
  };
  addPair(current);
  asideDescendantPairs(threads, threadId, addPair);
  return pairs;
}

export interface AsideKeyGroup {
  key: string;
  machineIds: string[];
  providerIds: string[];
  pairs: AsidePair[];
}

function collectAsideKeyGroups(pairs: AsidePair[]): AsideKeyGroup[] {
  const sourceIds = asideSourceIds();
  const groups = new Map<
    string,
    { hostId: string; providers: Set<string>; pairs: AsidePair[] }
  >();
  for (const pair of pairs) {
    let group = groups.get(pair.hostId);
    if (group === undefined) {
      group = { hostId: pair.hostId, providers: new Set(), pairs: [] };
      groups.set(pair.hostId, group);
    }
    group.providers.add(pair.providerId);
    group.pairs.push(pair);
  }
  return [...groups.values()].map((group) => {
    const machineIds = [group.hostId, ...sourceIds];
    return {
      key: machineIds.join("\n"),
      machineIds,
      providerIds: [...group.providers].sort(),
      pairs: group.pairs,
    };
  });
}

export interface AsideWindowLine {
  id: string;
  srText: string;
  shortLabel: string;
  usedPercent: number;
  countdown: string | null;
}

export interface AsideAccountLine {
  id: string;
  label: string | null;
  windows: AsideWindowLine[];
  message: string | null;
}

export interface AsidePairView {
  id: string;
  pending: boolean;
  provider: UsageProvider | null;
  providerName: string | null;
  machineName: string | null;
  accounts: AsideAccountLine[];
}

export interface AsideMachineGroupView {
  id: string;
  machineId: string;
  machineName: string | null;
  notice: {
    icon: "CloudOff" | "AlertTriangle" | "AlertCircle";
    message: string;
  } | null;
  pairs: AsidePairView[];
}

export interface AsideGroupView {
  caption: string;
  machineGroups: AsideMachineGroupView[];
}

export interface AsideSourceState {
  data: UsageSnapshot | null;
  settled: boolean;
  requestFailed: boolean;
}

function asideAccountLine(
  provider: UsageProvider,
  pooledName: string | null,
  ordinal: number | null,
): AsideAccountLine {
  const label =
    pooledName === null || ordinal === null
      ? null
      : `${pooledName} · ${ordinal}`;
  const email =
    provider.usage?.status === "ok" ? provider.usage.accountEmail : null;
  const windows =
    provider.usage?.status === "ok"
      ? provider.usage.windows.map((window) => {
          const countdown = formatResetCountdown(window.resetsAt);
          const srText =
            `${provider.displayName}${label === null ? "" : ` ${label}`}` +
            `${email === null ? "" : ` (${email})`}` +
            ` ${window.label}: ${Math.round(window.usedPercent)}% used` +
            `${countdown === null ? "" : `, resets in ${countdown}`}`;
          return {
            id: window.label,
            srText,
            shortLabel: shortWindowLabel(window.label),
            usedPercent: window.usedPercent,
            countdown,
          };
        })
      : [];
  return {
    id: provider.id,
    label,
    windows,
    message: windows.length > 0 ? null : accountStatusMessage(provider),
  };
}

function asideOrdinals(
  machine: UsageMachine,
  providerId: string,
): Map<string, number> {
  const ordinals = new Map<string, number>();
  let sequence = 0;
  for (const row of machine.providers) {
    if (row.providerId !== providerId) continue;
    sequence += 1;
    if (!ordinals.has(row.id)) ordinals.set(row.id, sequence);
  }
  return ordinals;
}

function buildAsidePairView(
  pair: AsidePair,
  machine: UsageMachine | null,
  machineName: string | null,
  seenProviderIds: Set<string>,
): { view: AsidePairView; hasData: boolean } | null {
  const rows =
    machine === null
      ? []
      : machine.providers.filter(
          (provider) => provider.providerId === pair.providerId,
        );
  if (machine === null || rows.length === 0) return null;
  const pooled = machine.id.startsWith("source:");
  const ordinals = pooled ? asideOrdinals(machine, pair.providerId) : null;
  const accounts: AsideAccountLine[] = [];
  let hasData = false;
  for (const row of rows) {
    if (seenProviderIds.has(row.id)) continue;
    seenProviderIds.add(row.id);
    const line = asideAccountLine(
      row,
      pooled ? machineName : null,
      ordinals?.get(row.id) ?? null,
    );
    if (row.usage !== null) hasData = true;
    accounts.push(line);
  }
  if (accounts.length === 0) return null;
  const lead = rows[0];
  return {
    view: {
      id: pair.key,
      pending: false,
      provider: lead ?? null,
      providerName: lead?.displayName ?? pair.providerId,
      machineName,
      accounts,
    },
    hasData,
  };
}

function buildAsideMachineGroup(
  keyGroup: AsideKeyGroup,
  machineId: string,
  machinePairs: AsidePair[],
  state: AsideSourceState,
  seenProviderIds: Set<string>,
): AsideMachineGroupView | null {
  const machine =
    state.data?.machines.find((item) => item.id === machineId) ?? null;
  const machineName = machine?.displayName ?? machinePairs[0]?.hostName ?? null;
  const views: AsidePairView[] = [];
  let hasData = false;
  for (const pair of machinePairs) {
    if (!state.settled) {
      views.push({
        id: pair.key,
        pending: true,
        provider: null,
        providerName: null,
        machineName,
        accounts: [],
      });
      continue;
    }
    const built = buildAsidePairView(
      pair,
      machine,
      machineName,
      seenProviderIds,
    );
    if (built === null) continue;
    hasData ||= built.hasData;
    views.push(built.view);
  }
  const failed =
    state.requestFailed || (machine !== null && machine.error !== null);
  let notice: AsideMachineGroupView["notice"] = null;
  if (machine !== null && machine.status === "disconnected")
    notice = {
      icon: "CloudOff",
      message: offlineUsageMessage(machine, hasData),
    };
  else if (failed)
    notice = hasData
      ? { icon: "AlertTriangle", message: usageFeedbackMessages.refreshFailed }
      : { icon: "AlertCircle", message: usageFeedbackMessages.loadFailed };
  if (views.length === 0 && notice === null) return null;
  return {
    id: `${keyGroup.key}>${machineId}`,
    machineId,
    machineName,
    notice,
    pairs: views,
  };
}

function groupAsidePairsByMachine(
  pairs: AsidePair[],
  resolveSource: (providerId: string) => string | null,
): Map<string, AsidePair[]> {
  const byMachine = new Map<string, AsidePair[]>();
  for (const pair of pairs) {
    const machineId = resolveSource(pair.providerId) ?? pair.hostId;
    const bucket = byMachine.get(machineId);
    if (bucket === undefined) byMachine.set(machineId, [pair]);
    else bucket.push(pair);
  }
  return byMachine;
}

function buildAsideKeyGroupMachineGroups(
  keyGroup: AsideKeyGroup,
  pairs: AsidePair[],
  state: AsideSourceState,
  resolveSource: (providerId: string) => string | null,
  seenProviderIds: Set<string>,
): AsideMachineGroupView[] {
  const machineGroups: AsideMachineGroupView[] = [];
  for (const [machineId, machinePairs] of groupAsidePairsByMachine(
    pairs,
    resolveSource,
  )) {
    const machineGroup = buildAsideMachineGroup(
      keyGroup,
      machineId,
      machinePairs,
      state,
      seenProviderIds,
    );
    if (machineGroup !== null) machineGroups.push(machineGroup);
  }
  return machineGroups;
}

export function buildAsideGroups(
  keyGroups: AsideKeyGroup[],
  stateFor: (keyGroup: AsideKeyGroup) => AsideSourceState,
  resolveSource: (providerId: string) => string | null = asideSourceMachineId,
): AsideGroupView[] {
  const seenProviderIds = new Set<string>();
  const groups: AsideGroupView[] = [];
  for (const caption of ["This thread", "Subthreads"] as const) {
    const machineGroups: AsideMachineGroupView[] = [];
    for (const keyGroup of keyGroups) {
      const pairs = keyGroup.pairs.filter((pair) =>
        caption === "This thread" ? pair.isCurrent : !pair.isCurrent,
      );
      if (pairs.length === 0) continue;
      machineGroups.push(
        ...buildAsideKeyGroupMachineGroups(
          keyGroup,
          pairs,
          stateFor(keyGroup),
          resolveSource,
          seenProviderIds,
        ),
      );
    }
    if (machineGroups.length === 0) continue;
    groups.push({ caption, machineGroups });
  }
  return groups;
}

function AsideWindowRow({ line }: { line: AsideWindowLine }) {
  return (
    <li className="flex h-5 min-w-0 items-center">
      <span className="sr-only">{line.srText}</span>
      <span
        aria-hidden="true"
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        <span className="w-6 shrink-0 text-muted-foreground">
          {line.shortLabel}
        </span>
        <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-border">
          <span
            className={
              "block h-full rounded-full " +
              usageBarColorClass(line.usedPercent)
            }
            style={{
              width: Math.max(2, Math.min(100, line.usedPercent)) + "%",
            }}
          />
        </span>
        <span
          className={cn(
            "shrink-0 tabular-nums",
            usageToneTextClass(line.usedPercent, "text-foreground"),
          )}
        >
          {Math.round(line.usedPercent)}%
        </span>
        <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
          {line.countdown ?? "—"}
        </span>
      </span>
    </li>
  );
}

function AsidePairBlock({
  pair,
  nameMachine,
}: {
  pair: AsidePairView;
  nameMachine: boolean;
}) {
  if (pair.pending) return <UsageSkeleton rows={1} />;
  if (pair.provider === null || pair.providerName === null) return null;
  const header =
    nameMachine && pair.machineName !== null
      ? `${pair.machineName} · ${pair.providerName}`
      : pair.providerName;
  return (
    <div className="min-w-0">
      <div className="flex h-5 min-w-0 items-center gap-1.5">
        <ProviderIcon
          providerKind="agent"
          provider={pair.provider}
          fallback="Bot"
          className="size-3 shrink-0"
        />
        <span
          title={header}
          className="min-w-0 flex-1 truncate font-medium text-foreground"
        >
          {header}
        </span>
      </div>
      {pair.accounts.map((account) => (
        <div key={account.id} className="min-w-0">
          {account.label === null ? null : (
            <p className="truncate text-muted-foreground">{account.label}</p>
          )}
          {account.message === null ? (
            <ul className="min-w-0">
              {account.windows.map((window) => (
                <AsideWindowRow key={window.id} line={window} />
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">{account.message}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function ProviderUsageAsideContent({
  groups,
  nameMachine = false,
}: {
  groups: AsideGroupView[];
  nameMachine?: boolean;
}) {
  if (groups.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2.5 text-2xs">
      {groups.map((group) => (
        <div key={group.caption} className="min-w-0">
          <p className="mb-1 font-medium text-muted-foreground">
            {group.caption}
          </p>
          <div className="flex min-w-0 flex-col gap-2">
            {group.machineGroups.map((machineGroup) => (
              <div
                key={machineGroup.id}
                className="flex min-w-0 flex-col gap-1"
              >
                {machineGroup.pairs.map((pair) => (
                  <AsidePairBlock
                    key={pair.id}
                    pair={pair}
                    nameMachine={nameMachine}
                  />
                ))}
                {machineGroup.notice === null ? null : (
                  <p className="flex min-w-0 items-start gap-1 text-muted-foreground">
                    <Icon
                      name={machineGroup.notice.icon}
                      aria-hidden="true"
                      className="mt-px size-3 shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      {nameMachine && machineGroup.machineName !== null
                        ? `${machineGroup.machineName}: ${machineGroup.notice.message}`
                        : machineGroup.notice.message}
                    </span>
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function asideSourceStateFor(key: string): AsideSourceState {
  const entry = asideEntries.get(key);
  return {
    data: entry?.data ?? null,
    settled:
      entry !== undefined &&
      (entry.lastSuccessAt !== null || entry.lastRequestFailedAt !== null),
    requestFailed: entry !== undefined && entry.lastRequestFailedAt !== null,
  };
}

function asideGroupNameMachine(groups: AsideGroupView[]): boolean {
  return (
    new Set(
      groups.flatMap((group) =>
        group.machineGroups.map((machineGroup) => machineGroup.machineId),
      ),
    ).size > 1
  );
}

export function registerComposerAside(
  app: Parameters<PluginAppSetup>[0],
): void {
  app.slots.experimental_composerAside({
    id: "usage",
    title: "Provider usage",
    component: ProviderUsageAside,
  });
}

export function ProviderUsageAside({ threadId }: PluginComposerAsideProps) {
  const pluginId = experimental_usePluginId();
  const sidebarThreads = experimental_useSidebarThreads();
  useSyncExternalStore(subscribeAsideStore, getAsideVersion, getAsideVersion);
  const [instance] = useState(() => ({ id: asideInstanceSequence++ }));
  const keyGroups =
    sidebarThreads.status === "ready"
      ? collectAsideKeyGroups(
          collectAsidePairs(sidebarThreads.threads, threadId),
        )
      : [];
  const signature = keyGroups
    .map((group) => `${group.key}>${group.providerIds.join(",")}`)
    .join(";");
  const keyGroupsRef = useRef(keyGroups);
  useLayoutEffect(() => {
    keyGroupsRef.current = keyGroups;
  });
  useEffect(() => {
    const groups = keyGroupsRef.current;
    for (const group of groups)
      subscribeAsideInstance(
        group.key,
        pluginId,
        group.machineIds,
        instance,
        group.providerIds,
      );
    return () => {
      for (const group of groups) unsubscribeAsideInstance(group.key, instance);
    };
  }, [instance, pluginId, signature]);
  if (sidebarThreads.status !== "ready") return null;
  const groups = buildAsideGroups(keyGroups, (keyGroup) =>
    asideSourceStateFor(keyGroup.key),
  );
  if (groups.length === 0) return null;
  return (
    <ProviderUsageAsideContent
      groups={groups}
      nameMachine={asideGroupNameMachine(groups)}
    />
  );
}
