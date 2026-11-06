import {
  branchPromotionRequestSchema,
  branchPromotionSnapshotSchema,
} from "bb-checkout-contract/branch-promotion";

export const branchPromotionRpc = {
  promoteBranch: {
    input: branchPromotionRequestSchema,
    output: branchPromotionSnapshotSchema,
  },
};
