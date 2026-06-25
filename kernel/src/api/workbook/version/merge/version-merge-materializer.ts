import type { VersionMergeChange } from '@mog-sdk/contracts/api';

import type { VersionMergeCommitCapture } from '../../../../document/version-store/commit-service';
import { createVersionObjectRecord } from '../../../../document/version-store/object-store';
import {
  failedStoreResult,
  versionStoreDiagnostic,
} from '../../../../document/version-store/provider';
import { captureWorkbookSnapshotRootRecord } from '../../../../document/version-store/snapshot-root-capture';
import { createSnapshotRootMaterializationService } from '../../../../document/version-store/snapshot-root-materialization-service';
import { createDocumentLifecycleSnapshotRootHydrator } from '../../../document/snapshot-root-lifecycle-hydrator';
import { parseMergeChanges } from '../apply-merge/materialization-plan/version-merge-materialization-plan';
import {
  applyMergeChanges,
  MERGE_CAPTURE_AUTHOR,
  mergeMutationSegmentPayload,
} from '../apply-merge/version-merge-materialization-writes';
import { DEFAULT_MERGE_COMMIT_MATERIALIZER_KIND } from './version-merge-materializer-support';

export { DEFAULT_MERGE_COMMIT_MATERIALIZER_KIND };

export interface SemanticMergeCommitCaptureOptions {
  readonly userTimezone: string;
  readonly now?: () => Date;
}

export function createSemanticMergeCommitCapture(
  options: SemanticMergeCommitCaptureOptions,
): VersionMergeCommitCapture {
  const now = options.now ?? (() => new Date());
  return async (input) => {
    const parsed = parseMergeChanges(input);
    if (!parsed.ok) return parsed.failure;

    const createdAt = now().toISOString();
    const materialization = await createSnapshotRootMaterializationService({
      provider: input.provider,
      hydrator: createDocumentLifecycleSnapshotRootHydrator({
        userTimezone: options.userTimezone,
        documentIdPrefix: `version-merge-${shortCommitId(input.ours)}`,
      }),
    }).materializeCommitSnapshotRoot(input.ours);

    if (!materialization.ok) {
      return failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_PROVIDER_FAILED', {
            operation: 'commitGraphWrite',
            documentScope: input.provider.documentScope,
            namespace: input.namespace,
            refName: input.currentRef.name,
            commitId: input.ours,
            safeMessage:
              'Version merge materialization could not hydrate the expected target head.',
            recoverability: 'retry',
            mutationGuarantee: 'no-write-attempted',
            details: { cause: materialization.error.code },
          }),
        ],
        'no-write-attempted',
        true,
      );
    }

    const materialized = materialization.materialized;
    try {
      await applyMergeChanges(materialized.context, input, parsed.changes, createdAt);
      const snapshotRootRecord = await captureWorkbookSnapshotRootRecord(
        input.namespace,
        materialized.context.computeBridge,
      );
      const semanticChangeSetRecord = await createVersionObjectRecord(input.namespace, {
        objectType: 'workbook.semanticChangeSet.v1',
        schemaVersion: 1,
        payloadEncoding: 'mog-canonical-json-v1',
        dependencies: [],
        payload: {
          schemaVersion: 1,
          merge: {
            baseCommitId: input.base,
            oursCommitId: input.ours,
            theirsCommitId: input.theirs,
            targetRef: input.targetRef,
            expectedTargetHead: input.expectedTargetHead,
            resolutionCount: input.resolutionCount,
            materializer: DEFAULT_MERGE_COMMIT_MATERIALIZER_KIND,
          },
          changes: parsed.changes.map((entry) => semanticMergeDiffChangeRecord(entry.change)),
          mergeChanges: parsed.changes.map((entry) => semanticMergeChangeRecord(entry.change)),
        },
      });
      const mutationSegmentRecords = [
        await createVersionObjectRecord(input.namespace, {
          objectType: 'workbook.mutationSegment.v1',
          schemaVersion: 1,
          payloadEncoding: 'mog-canonical-json-v1',
          dependencies: [],
          payload: mergeMutationSegmentPayload(input, parsed.changes, createdAt),
        }),
      ];

      return {
        status: 'success' as const,
        input: {
          snapshotRootRecord,
          semanticChangeSetRecord,
          mutationSegmentRecords,
          author: MERGE_CAPTURE_AUTHOR,
          createdAt,
          completenessDiagnostics: [],
        },
      };
    } catch (error) {
      return failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_PROVIDER_FAILED', {
            operation: 'commitGraphWrite',
            documentScope: input.provider.documentScope,
            namespace: input.namespace,
            refName: input.currentRef.name,
            commitId: input.ours,
            safeMessage: 'Version merge materialization failed while applying the merge plan.',
            recoverability: 'retry',
            mutationGuarantee: 'no-write-attempted',
            details: { cause: errorName(error) },
          }),
        ],
        'no-write-attempted',
        true,
      );
    } finally {
      await disposeQuietly(() => materialized.dispose());
    }
  };
}

function semanticMergeDiffChangeRecord(change: VersionMergeChange) {
  return {
    structural: change.structural,
    before: change.base,
    after: change.merged,
    ...(change.display ? { display: change.display } : {}),
  };
}

function semanticMergeChangeRecord(change: VersionMergeChange) {
  return {
    structural: change.structural,
    base: change.base,
    ...(change.ours ? { ours: change.ours } : {}),
    ...(change.theirs ? { theirs: change.theirs } : {}),
    merged: change.merged,
    ...(change.display ? { display: change.display } : {}),
    ...(change.diagnostics && change.diagnostics.length > 0
      ? { diagnostics: change.diagnostics }
      : {}),
  };
}

async function disposeQuietly(dispose: () => Promise<void>): Promise<void> {
  try {
    await dispose();
  } catch {
    // Best-effort cleanup of the scratch merge lifecycle.
  }
}

function shortCommitId(commitId: string): string {
  return commitId.replace(/^commit:sha256:/, '').slice(0, 12);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
