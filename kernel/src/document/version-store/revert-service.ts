import type {
  VersionRevertInput,
  VersionRevertOptions,
  VersionRevertTarget,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { WorkbookCommit } from './commit-store';
import {
  diagnosticsForGraphRead,
  isRetryableGraphWriteFailure,
  mapCommitGraphDiagnostics,
} from './commit-service-diagnostics';
import { openVisibleVersionGraph } from './commit-service-open-graph';
import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  type VersionGraphBranchRefName,
} from './graph';
import { createVersionObjectRecord, type VersionObjectRecord } from './object-store';
import {
  failedStoreResult,
  versionStoreDiagnostic,
  type VersionStoreDiagnostic,
  type VersionStoreFailure,
  type VersionGraphStore,
  type VersionStoreProvider,
} from './provider';
import { REF_NAME_STORAGE_PREFIX, validateRefName } from './refs/ref-name';
import { revertDiagnostic } from './revert-service/diagnostics';
import { planTopOfRefRevert } from './revert-service/planning';
import type { RevertProviderResult } from './revert-service/types';

export type WorkbookVersionRevertServiceOptions = {
  readonly provider: VersionStoreProvider;
};

const VERSION_REVERT_AUTHOR: VersionAuthor = Object.freeze({
  authorId: 'mog.version-revert',
  actorKind: 'system',
  displayName: 'Mog Version Revert',
});

export class WorkbookVersionRevertService {
  private readonly provider: VersionStoreProvider;

  constructor(options: WorkbookVersionRevertServiceOptions) {
    this.provider = options.provider;
  }

  async revert(
    input: VersionRevertInput,
    options: VersionRevertOptions = {},
  ): Promise<RevertProviderResult> {
    const availability = this.validateProviderAvailability();
    if (availability) return availability;

    const opened = await openVisibleVersionGraph(this.provider, 'commitGraphWrite');
    if (!opened.ok) {
      return failedStoreResult(opened.diagnostics, 'no-write-attempted', opened.retryable);
    }

    const targetRefName = normalizeRevertTargetRef(input.targetRef);
    if (!targetRefName.ok) {
      return failedStoreResult(targetRefName.diagnostics, 'no-write-attempted');
    }

    const current = await opened.graph.readRef(targetRefName.refName);
    if (current.status !== 'success' || current.ref.name === VERSION_GRAPH_HEAD_REF) {
      return failedStoreResult(
        diagnosticsForGraphRead(current.diagnostics, 'commitGraphWrite'),
        'no-write-attempted',
      );
    }

    const closure = await opened.graph.readCommitClosure(current.ref.commitId);
    if (closure.status !== 'success') {
      return failedStoreResult(
        mapCommitGraphDiagnostics(closure.diagnostics),
        'no-write-attempted',
      );
    }

    const commitsById = new Map(closure.commits.map((commit) => [commit.id, commit]));
    const plan = planTopOfRefRevert(input.target, current.ref, commitsById);
    if (!plan.ok) return plan.result;

    if (options.dryRun === true) {
      return {
        schemaVersion: 1,
        status: 'planned',
        target: input.target,
        diagnostics: [],
        mutationGuarantee: 'no-write-attempted',
      };
    }

    const snapshotRootRecord = await readCommitObjectRecord(
      opened.graph,
      plan.restoreCommit,
      'workbook.snapshotRoot.v1',
      plan.restoreCommit.payload.snapshotRootDigest,
    );
    if (!snapshotRootRecord.ok) return snapshotRootRecord.result;

    const semanticChangeSetRecord = await buildRevertSemanticChangeSetRecord({
      namespace: opened.namespace,
      graph: opened.graph,
      target: input.target,
      targetRef: current.ref.name,
      reason: input.reason,
      commitsToInvert: plan.commitsToInvert,
    });
    if (!semanticChangeSetRecord.ok) return semanticChangeSetRecord.result;

    const result = await opened.graph.commit({
      snapshotRootRecord: snapshotRootRecord.record,
      semanticChangeSetRecord: semanticChangeSetRecord.record,
      author: VERSION_REVERT_AUTHOR,
      createdAt: new Date().toISOString(),
      completenessDiagnostics: [],
      targetRef: current.ref.name,
      expectedHeadCommitId: current.ref.commitId,
      expectedTargetRefVersion: current.ref.revision,
      parentCommitIds: [current.ref.commitId],
    });

    if (result.status === 'success') {
      return {
        schemaVersion: 1,
        status: 'applied',
        target: input.target,
        commitRef: {
          id: result.commit.id,
          refName: result.ref.name,
          resolvedFrom: input.targetRef === undefined ? VERSION_GRAPH_HEAD_REF : result.ref.name,
          refRevision: result.ref.revision,
        },
        diagnostics: [],
        mutationGuarantee: 'revert-commit-created',
      };
    }

    return failedStoreResult(
      mapCommitGraphDiagnostics(result.diagnostics),
      result.mutationGuarantee,
      isRetryableGraphWriteFailure(result.diagnostics),
    );
  }

  private validateProviderAvailability(): VersionStoreFailure | null {
    if (!this.provider.capabilities.reads.graphRegistry) {
      return failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_STORE_UNAVAILABLE', {
            operation: 'commitGraphWrite',
            documentScope: this.provider.documentScope,
            safeMessage: 'Version graph registry reads are unavailable for revert.',
            recoverability: 'retry',
            mutationGuarantee: 'no-write-attempted',
          }),
        ],
        'no-write-attempted',
        true,
      );
    }

    if (!this.provider.capabilities.writes.commitGraphWrite) {
      return failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_STORE_READ_ONLY', {
            operation: 'commitGraphWrite',
            documentScope: this.provider.documentScope,
            safeMessage: 'Version graph writes are disabled for revert.',
            mutationGuarantee: 'no-write-attempted',
          }),
        ],
        'no-write-attempted',
      );
    }

    return null;
  }
}

export function createWorkbookVersionRevertService(
  options: WorkbookVersionRevertServiceOptions,
): WorkbookVersionRevertService {
  return new WorkbookVersionRevertService(options);
}

async function buildRevertSemanticChangeSetRecord(input: {
  readonly namespace: Parameters<typeof createVersionObjectRecord>[0];
  readonly graph: Pick<VersionGraphStore, 'getObjectRecord'>;
  readonly target: VersionRevertTarget;
  readonly targetRef: string;
  readonly reason?: string;
  readonly commitsToInvert: readonly WorkbookCommit[];
}): Promise<
  | { readonly ok: true; readonly record: VersionObjectRecord<unknown> }
  | { readonly ok: false; readonly result: RevertProviderResult }
> {
  const invertedChanges: unknown[] = [];
  const sourceSemanticChangeSetDigests: string[] = [];

  for (const commit of input.commitsToInvert) {
    const semanticRecord = await readCommitObjectRecord(
      input.graph,
      commit,
      'workbook.semanticChangeSet.v1',
      commit.payload.semanticChangeSetDigest,
    );
    if (!semanticRecord.ok) return semanticRecord;

    sourceSemanticChangeSetDigests.push(commit.payload.semanticChangeSetDigest.digest);
    const inverted = invertSemanticChangeSetPayload(
      semanticRecord.record.preimage.payload,
      commit.id,
    );
    if (!inverted.ok) return inverted;
    invertedChanges.push(...inverted.changes);
  }

  const payload = {
    schemaVersion: 1,
    source: {
      kind: 'versionRevert',
      target: input.target,
      targetRef: input.targetRef,
      revertedCommitIds: input.commitsToInvert.map((commit) => commit.id),
      sourceSemanticChangeSetDigests,
      ...(input.reason ? { reason: input.reason } : {}),
    },
    changes: invertedChanges,
  };

  return {
    ok: true,
    record: await createVersionObjectRecord(input.namespace, {
      objectType: 'workbook.semanticChangeSet.v1',
      schemaVersion: 1,
      payloadEncoding: 'mog-canonical-json-v1',
      dependencies: [],
      payload,
    }),
  };
}

async function readCommitObjectRecord(
  graph: {
    getObjectRecord<TPayload>(ref: {
      readonly kind: 'object';
      readonly objectType: 'workbook.snapshotRoot.v1' | 'workbook.semanticChangeSet.v1';
      readonly digest: WorkbookCommit['payload']['snapshotRootDigest'];
    }): Promise<VersionObjectRecord<TPayload>>;
  },
  commit: WorkbookCommit,
  objectType: 'workbook.snapshotRoot.v1' | 'workbook.semanticChangeSet.v1',
  digest: WorkbookCommit['payload']['snapshotRootDigest'],
): Promise<
  | { readonly ok: true; readonly record: VersionObjectRecord<unknown> }
  | { readonly ok: false; readonly result: RevertProviderResult }
> {
  try {
    return {
      ok: true,
      record: await graph.getObjectRecord({ kind: 'object', objectType, digest }),
    };
  } catch {
    return {
      ok: false,
      result: failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_MISSING_DEPENDENCY', {
            operation: 'commitGraphWrite',
            safeMessage: 'Version revert could not read a required commit dependency object.',
            commitId: commit.id,
            mutationGuarantee: 'no-write-attempted',
            details: {
              objectType,
              objectDigest: digest.digest,
            },
          }),
        ],
        'no-write-attempted',
      ),
    };
  }
}

function invertSemanticChangeSetPayload(
  payload: unknown,
  commitId: string,
):
  | { readonly ok: true; readonly changes: readonly unknown[] }
  | { readonly ok: false; readonly result: RevertProviderResult } {
  if (!isRecord(payload) || !Array.isArray(payload.changes)) {
    return unsupportedSemanticPayload(commitId);
  }

  const sourceChanges =
    Array.isArray(payload.reviewChanges) && payload.reviewChanges.length > 0
      ? payload.reviewChanges
      : payload.changes;
  const changes: unknown[] = [];
  for (let index = sourceChanges.length - 1; index >= 0; index--) {
    const inverted = invertSemanticChange(sourceChanges[index], commitId, index);
    if (!inverted.ok) return unsupportedSemanticPayload(commitId);
    changes.push(inverted.change);
  }

  return { ok: true, changes };
}

function invertSemanticChange(
  change: unknown,
  commitId: string,
  index: number,
): { readonly ok: true; readonly change: unknown } | { readonly ok: false } {
  if (!isRecord(change) || !('before' in change) || !('after' in change)) {
    return { ok: false };
  }

  return {
    ok: true,
    change: {
      ...change,
      structural: rewriteRevertStructuralMetadata(change.structural, commitId, index),
      before: change.after,
      after: change.before,
    },
  };
}

function rewriteRevertStructuralMetadata(
  structural: unknown,
  commitId: string,
  index: number,
): unknown {
  if (!isRecord(structural) || typeof structural.changeId !== 'string') return structural;
  return {
    ...structural,
    changeId: `revert:${commitId}:${index}:${structural.changeId}`,
  };
}

function unsupportedSemanticPayload(commitId: string): {
  readonly ok: false;
  readonly result: RevertProviderResult;
} {
  return {
    ok: false,
    result: {
      status: 'failed',
      diagnostics: [
        revertDiagnostic(
          'VERSION_UNSUPPORTED_SCHEMA',
          'Version revert could not derive an inverse semantic change set for the target commit.',
          { commitId },
          'repair',
          'no-write-attempted',
        ),
      ],
      mutationGuarantee: 'no-write-attempted',
      retryable: false,
    },
  };
}

function normalizeRevertTargetRef(
  value: VersionRevertInput['targetRef'],
):
  | { readonly ok: true; readonly refName: VersionGraphBranchRefName }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  const publicRef = value ?? VERSION_GRAPH_MAIN_REF;
  const branchName = publicRef.startsWith(REF_NAME_STORAGE_PREFIX)
    ? publicRef.slice(REF_NAME_STORAGE_PREFIX.length)
    : publicRef;
  const parsed = validateRefName(branchName, 'targetRef');
  if (!parsed.ok) {
    return {
      ok: false,
      diagnostics: [
        versionStoreDiagnostic('VERSION_INVALID_OPTIONS', {
          operation: 'commitGraphWrite',
          safeMessage: 'Version revert targetRef must name a public branch ref.',
          mutationGuarantee: 'no-write-attempted',
          details: { targetRef: String(value ?? VERSION_GRAPH_MAIN_REF) },
        }),
      ],
    };
  }

  return {
    ok: true,
    refName: `${REF_NAME_STORAGE_PREFIX}${parsed.name}` as VersionGraphBranchRefName,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
