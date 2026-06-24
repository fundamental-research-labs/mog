import type { DocumentContext } from '../../context';
import type { CheckoutSnapshotApplyInput } from '../../document/version-store/checkout-apply';
import type { CheckoutMaterializationDiagnostic } from '../../document/version-store/checkout-service';
import type { SnapshotRootFreshLifecycleMaterialization } from '../document/snapshot-root-lifecycle-hydrator';
import type { WorkbookVersioningConfig } from './types';
import { createWorkbookCheckoutSnapshotMaterializer } from './version/checkout/version-checkout-materializer';

export function withDefaultWorkbookCheckoutMaterializer(
  versioning: WorkbookVersioningConfig | undefined,
  deps: {
    readonly currentContext: () => DocumentContext;
    readonly revalidateCheckoutPublish: (
      input: CheckoutSnapshotApplyInput,
    ) => readonly CheckoutMaterializationDiagnostic[];
    readonly publishCheckoutMaterialization: (
      materialization: SnapshotRootFreshLifecycleMaterialization,
      input: CheckoutSnapshotApplyInput,
    ) => Promise<void>;
  },
): WorkbookVersioningConfig | undefined {
  if (
    !versioning ||
    versioning.checkoutSnapshotMaterializer ||
    !versioning.snapshotRootByteSyncPort
  ) {
    return versioning;
  }

  return {
    ...versioning,
    checkoutSnapshotMaterializer: createWorkbookCheckoutSnapshotMaterializer(deps),
  };
}
