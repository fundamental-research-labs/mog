import type {
  VersionNormalCommitCaptureResult,
  VersionNormalCommitMaterializedCaptureResult,
  VersionNormalCommitMaterializedCaptureSuccess,
} from './commit-service-types';
import type { VersionGraphNamespace } from './object-store';
import { failedStoreResult, versionStoreDiagnostic, type VersionStoreProvider } from './provider';
import {
  captureWorkbookSnapshotRootRecord,
  type SnapshotRootByteSyncPort,
} from './snapshot-root-capture';

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
