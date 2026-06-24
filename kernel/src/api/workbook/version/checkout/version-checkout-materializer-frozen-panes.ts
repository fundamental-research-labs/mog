import type { CheckoutSnapshotApplyInput } from '../../../../document/version-store/checkout-apply';
import type { CheckoutMaterializationDiagnostic } from '../../../../document/version-store/checkout-service';
import type { SnapshotRootFreshLifecycleMaterialization } from '../../../document/snapshot-root-lifecycle-hydrator';
import { checkoutRebindIdentityDiagnosticDetails } from './version-checkout-rebind';

type FrozenPaneMaterializationResult =
  | { readonly status: 'materialized' }
  | {
      readonly status: 'failed';
      readonly diagnostics: readonly CheckoutMaterializationDiagnostic[];
      readonly mutationGuarantee: 'no-workbook-mutation';
    };

export async function materializeCheckoutFrozenPanes(
  input: CheckoutSnapshotApplyInput,
  materialization: SnapshotRootFreshLifecycleMaterialization,
): Promise<FrozenPaneMaterializationResult> {
  const ctx = materialization.context;
  let activeSheetId: string | null = null;

  try {
    const sheetIds = await ctx.computeBridge.getAllSheetIds();
    for (const sheetId of sheetIds) {
      activeSheetId = String(sheetId);
      const rustFrozen = await ctx.computeBridge.getFrozenPanesQuery(sheetId);
      const mirrorFrozen = ctx.mirror.getFrozenPanes(sheetId);
      if (mirrorFrozen.rows === rustFrozen.rows && mirrorFrozen.cols === rustFrozen.cols) {
        continue;
      }
      await ctx.computeBridge.setFrozenPanes(sheetId, rustFrozen.rows, rustFrozen.cols);
    }
    return { status: 'materialized' };
  } catch (error) {
    return {
      status: 'failed',
      diagnostics: [
        {
          code: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
          severity: 'error',
          message:
            'Fresh lifecycle checkout materialization could not materialize frozen pane sheet metadata.',
          commitId: input.commitId,
          details: {
            ...checkoutMaterializationErrorDetails(error),
            phase: 'frozenPanes',
            partialSnapshot: true,
            ...(activeSheetId ? { sheetId: activeSheetId } : {}),
          },
        },
      ],
      mutationGuarantee: 'no-workbook-mutation',
    };
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function checkoutMaterializationErrorDetails(
  error: unknown,
): CheckoutMaterializationDiagnostic['details'] {
  return checkoutRebindIdentityDiagnosticDetails(error) ?? { cause: errorName(error) };
}
