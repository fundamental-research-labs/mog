import type {
  VersionNormalCommitCaptureResult,
  VersionNormalCommitMaterializedCaptureResult,
  VersionNormalCommitMaterializedCaptureSuccess,
} from './commit-service-types';
import { createVersionObjectRecord, type VersionGraphNamespace } from './object-store';
import { failedStoreResult, versionStoreDiagnostic, type VersionStoreProvider } from './provider';
import {
  captureWorkbookSnapshotRootRecord,
  type SnapshotRootByteSyncPort,
} from './snapshot-root-capture';

export const DEFERRED_SNAPSHOT_ROOT_COMPLETENESS_CODE = 'VERSION_SNAPSHOT_ROOT_DEFERRED';

export async function materializeSnapshotRootForNormalCommit(options: {
  readonly provider: VersionStoreProvider;
  readonly namespace: VersionGraphNamespace;
  readonly snapshotRootByteSyncPort?: SnapshotRootByteSyncPort;
  readonly captured: Extract<VersionNormalCommitCaptureResult, { status: 'success' }>;
}): Promise<VersionNormalCommitMaterializedCaptureResult> {
  const { provider, namespace, snapshotRootByteSyncPort, captured } = options;
  if (!snapshotRootByteSyncPort) {
    if (captured.input.snapshotRootRecord) {
      return captured as VersionNormalCommitMaterializedCaptureSuccess;
    }
    return failedStoreResult(
      [
        versionStoreDiagnostic('VERSION_MISSING_CHANGE_SET', {
          operation: 'commitGraphWrite',
          documentScope: provider.documentScope,
          namespace,
          safeMessage:
            'No production snapshot-root capture service is attached for normal version commits.',
          mutationGuarantee: 'no-write-attempted',
        }),
      ],
      'no-write-attempted',
    );
  }

  const deferred = deferredSnapshotRootForLargeProjection(captured);
  if (deferred) {
    const snapshotRootRecord = await createVersionObjectRecord(namespace, {
      objectType: 'workbook.snapshotRoot.v1',
      schemaVersion: 1,
      payloadEncoding: 'mog-canonical-json-v1',
      dependencies: [],
      payload: {
        schemaVersion: 1,
        kind: 'deferredSnapshotRoot',
        reason: 'large-semantic-projection',
        reviewProjectionChangeCount: deferred.reviewProjectionChangeCount,
      },
    });
    return {
      ...captured,
      input: {
        ...captured.input,
        snapshotRootRecord,
        completenessDiagnostics: [
          ...(captured.input.completenessDiagnostics ?? []),
          {
            code: DEFERRED_SNAPSHOT_ROOT_COMPLETENESS_CODE,
            severity: 'error' as const,
            message:
              'Snapshot-root materialization was deferred for a large semantic projection commit.',
            path: 'snapshotRootRecord',
            details: {
              reason: 'large-semantic-projection',
              reviewProjectionChangeCount: deferred.reviewProjectionChangeCount,
            },
          },
        ],
      },
    };
  }

  try {
    const snapshotRootRecord = await captureWorkbookSnapshotRootRecord(
      namespace,
      snapshotRootByteSyncPort,
    );
    return {
      ...captured,
      input: {
        ...captured.input,
        snapshotRootRecord,
      },
    };
  } catch {
    return failedStoreResult(
      [
        versionStoreDiagnostic('VERSION_PROVIDER_FAILED', {
          operation: 'commitGraphWrite',
          documentScope: provider.documentScope,
          namespace,
          safeMessage: 'Version commit capture failed before graph mutation.',
          recoverability: 'retry',
          mutationGuarantee: 'no-write-attempted',
        }),
      ],
      'no-write-attempted',
      true,
    );
  }
}

function deferredSnapshotRootForLargeProjection(
  captured: Extract<VersionNormalCommitCaptureResult, { status: 'success' }>,
): { readonly reviewProjectionChangeCount: number } | null {
  const payload = captured.input.semanticChangeSetRecord.preimage.payload;
  if (!isRecord(payload) || !isRecord(payload.source)) return null;
  if (payload.source.kind !== 'semanticMutationProjection') return null;
  if (!isRecord(payload.compactReviewProjection)) return null;
  const count = payload.source.reviewProjectionChangeCount;
  return Number.isSafeInteger(count) && (count as number) > 0
    ? { reviewProjectionChangeCount: count as number }
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
