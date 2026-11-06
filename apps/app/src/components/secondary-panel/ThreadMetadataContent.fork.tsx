import type { Thread } from "@bb/domain";
import { BranchPromotionRow } from "./BranchPromotionRow.fork";
import type { CoreThreadInfoRegistration } from "./info/ThreadInfoSlots";

export function forkThreadInfoRows(
  rowGroups: { environment: CoreThreadInfoRegistration["group"] },
  useThreadInfoHost: () => { thread: Thread },
): readonly CoreThreadInfoRegistration[] {
  function CoreBranchPromotionRow() {
    return <BranchPromotionRow thread={useThreadInfoHost().thread} />;
  }
  return [
    {
      id: "branchPromotion",
      group: rowGroups.environment,
      order: 25,
      component: CoreBranchPromotionRow,
    },
  ];
}
