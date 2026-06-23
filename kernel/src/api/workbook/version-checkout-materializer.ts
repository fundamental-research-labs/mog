import type { DocumentContext } from '../../context';
import type {
  CheckoutSnapshotApplyInput,
  CheckoutSnapshotMaterializer,
} from '../../document/version-store/checkout-apply';
import type { CheckoutMaterializationDiagnostic } from '../../document/version-store/checkout-service';
import {
  createSnapshotRootReloadService,
  type SnapshotRootReloadDiagnostic,
} from '../../document/version-store/snapshot-root-reload-service';
import {
  createDocumentLifecycleSnapshotRootHydrator,
  type SnapshotRootFreshLifecycleMaterialization,
} from '../document/snapshot-root-lifecycle-hydrator';
import { checkoutRebindIdentityDiagnosticDetails } from './version-checkout-rebind';

export interface WorkbookCheckoutPublisher {
  currentContext(): DocumentContext;
  revalidateCheckoutPublish?(
    input: CheckoutSnapshotApplyInput,
  ): Promise<readonly CheckoutMaterializationDiagnostic[]> | readonly CheckoutMaterializationDiagnostic[];
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
            checkoutApplyDiagnostic(input, entry),
          ),
          mutationGuarantee:
            reloaded.freshLifecycleMutationGuarantee === 'unknown-after-hydrator-failure'
              ? 'unknown-after-partial-mutation'
              : 'no-workbook-mutation',
        };
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
              details: checkoutPublishErrorDetails(error),
            },
          ],
          mutationGuarantee: 'unknown-after-partial-mutation',
        };
      }

      return { status: 'applied' };
    },
  };
}

function checkoutApplyDiagnostic(
  input: CheckoutSnapshotApplyInput,
  diagnostic: SnapshotRootReloadDiagnostic,
): CheckoutMaterializationDiagnostic {
  return {
    code: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
    severity: diagnostic.severity === 'corruption' ? 'corruption' : 'error',
    message: diagnostic.message,
    commitId: input.commitId,
    objectDigest: input.plan.snapshotRootDigest,
    details: {
      cause: diagnostic.code,
      ...(diagnostic.path ? { path: diagnostic.path } : {}),
    },
  };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function checkoutPublishErrorDetails(
  error: unknown,
): CheckoutMaterializationDiagnostic['details'] {
  return checkoutRebindIdentityDiagnosticDetails(error) ?? { cause: errorName(error) };
}
