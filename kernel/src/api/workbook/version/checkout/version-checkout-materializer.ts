import type { DocumentContext } from '../../../../context';
import type {
  CheckoutSnapshotApplyInput,
  CheckoutSnapshotMaterializer,
} from '../../../../document/version-store/checkout-apply';
import type { CheckoutMaterializationDiagnostic } from '../../../../document/version-store/checkout-service';
import {
  createSnapshotRootReloadService,
  type SnapshotRootReloadDiagnostic,
} from '../../../../document/version-store/snapshot-root-reload-service';
import {
  createDocumentLifecycleSnapshotRootHydrator,
  type SnapshotRootFreshLifecycleMaterialization,
} from '../../../document/snapshot-root-lifecycle-hydrator';
import { materializeCheckoutFrozenPanes } from './version-checkout-materializer-frozen-panes';
import { checkoutRebindIdentityDiagnosticDetails } from './version-checkout-rebind';

export interface WorkbookCheckoutPublisher {
  currentContext(): DocumentContext;
  revalidateCheckoutPublish?(
    input: CheckoutSnapshotApplyInput,
  ):
    | Promise<readonly CheckoutMaterializationDiagnostic[]>
    | readonly CheckoutMaterializationDiagnostic[];
  publishCheckoutMaterialization(
    materialization: SnapshotRootFreshLifecycleMaterialization,
    input: CheckoutSnapshotApplyInput,
  ): Promise<void>;
}

export function createWorkbookCheckoutSnapshotMaterializer(
  publisher: WorkbookCheckoutPublisher,
): CheckoutSnapshotMaterializer {
  return {
    async applySnapshot(input) {
      const reloadService = createSnapshotRootReloadService({
        hydrator: createDocumentLifecycleSnapshotRootHydrator({
          userTimezone: publisher.currentContext().userTimezone,
          documentIdPrefix: `version-checkout-${input.commitId.replace(/[^a-z0-9]/gi, '-')}`,
        }),
      });
      const reloaded = await reloadService.reloadSnapshotRoot(input.snapshotRoot);
      if (!reloaded.ok) {
        return {
          status: 'failed',
          diagnostics: reloaded.diagnostics.map((entry) =>
            checkoutApplyDiagnostic(
              input,
              entry,
              reloaded.freshLifecycleMutationGuarantee === 'unknown-after-hydrator-failure',
            ),
          ),
          mutationGuarantee:
            reloaded.freshLifecycleMutationGuarantee === 'unknown-after-hydrator-failure'
              ? 'unknown-after-partial-mutation'
              : 'no-workbook-mutation',
        };
      }

      const settled = await settleMaterializedMirrorState(input, reloaded.materialized);
      if (settled.status === 'failed') {
        await reloaded.materialized.dispose();
        return settled;
      }

      const frozenPanesMaterialized = await materializeCheckoutFrozenPanes(
        input,
        reloaded.materialized,
      );
      if (frozenPanesMaterialized.status === 'failed') {
        await reloaded.materialized.dispose();
        return frozenPanesMaterialized;
      }

      const publishDiagnostics = await publisher.revalidateCheckoutPublish?.(input);
      if (publishDiagnostics && publishDiagnostics.length > 0) {
        await reloaded.materialized.dispose();
        return {
          status: 'failed',
          diagnostics: publishDiagnostics,
          mutationGuarantee: 'no-workbook-mutation',
        };
      }

      try {
        await publisher.publishCheckoutMaterialization(reloaded.materialized, input);
      } catch (error) {
        await reloaded.materialized.dispose();
        return {
          status: 'failed',
          diagnostics: [
            {
              code: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
              severity: 'error',
              message: 'Fresh lifecycle checkout materialization could not be published.',
              commitId: input.commitId,
              details: {
                ...checkoutPublishErrorDetails(error),
                partialSnapshot: true,
              },
            },
          ],
          mutationGuarantee: 'unknown-after-partial-mutation',
        };
      }

      return { status: 'applied' };
    },
  };
}

async function settleMaterializedMirrorState(
  input: CheckoutSnapshotApplyInput,
  materialization: SnapshotRootFreshLifecycleMaterialization,
): Promise<
  | { readonly status: 'settled' }
  | {
      readonly status: 'failed';
      readonly diagnostics: readonly CheckoutMaterializationDiagnostic[];
      readonly mutationGuarantee: 'no-workbook-mutation';
    }
> {
  try {
    await materialization.context.computeBridge.settleForMirror();
    return { status: 'settled' };
  } catch (error) {
    return {
      status: 'failed',
      diagnostics: [
        {
          code: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
          severity: 'error',
          message:
            'Fresh lifecycle checkout materialization could not settle mirrored sheet state.',
          commitId: input.commitId,
          details: {
            ...checkoutPublishErrorDetails(error),
            phase: 'settleForMirror',
            partialSnapshot: true,
          },
        },
      ],
      mutationGuarantee: 'no-workbook-mutation',
    };
  }
}

function checkoutApplyDiagnostic(
  input: CheckoutSnapshotApplyInput,
  diagnostic: SnapshotRootReloadDiagnostic,
  partialSnapshot: boolean,
): CheckoutMaterializationDiagnostic {
  return {
    code: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
    severity: diagnostic.severity === 'corruption' ? 'corruption' : 'error',
    message: diagnostic.message,
    commitId: input.commitId,
    objectDigest: input.plan.snapshotRootDigest,
    details: {
      cause: diagnostic.code,
      ...(partialSnapshot ? { partialSnapshot: true } : {}),
      ...(diagnostic.path ? { path: diagnostic.path } : {}),
    },
  };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function checkoutPublishErrorDetails(error: unknown): CheckoutMaterializationDiagnostic['details'] {
  return checkoutRebindIdentityDiagnosticDetails(error) ?? { cause: errorName(error) };
}
