import { atom, useAtom } from "jotai";
import type { ThreadHandoffComposeSeed } from "@bb/client-core";

const rootComposeHandoffSeedAtom = atom<ThreadHandoffComposeSeed | null>(null);

export function useRootComposeHandoffSeed() {
  return useAtom(rootComposeHandoffSeedAtom);
}
