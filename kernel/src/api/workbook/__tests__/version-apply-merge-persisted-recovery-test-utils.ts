import { jest } from '@jest/globals';

import type {
  VersionApplyMergeResult,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeResultId,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { applyPersistedMergeResult } from '../version-apply-merge-persisted';
import type { recoverPersistedMergeApplyPostCas } from '../version-apply-merge-recovery';
import { VERSION_GRAPH_MAIN_REF } from '../../../document/version-store/graph-store';
import {
  computeMergeApplyRefCasProof,
  idempotencyKeyForResolvedAttempt,
  intentIdForResolvedAttemptDigest,
  type MergeApplyIntentRecord,
  type MergeApplyIntentStore,
} from '../../../document/version-store/merge-apply-intent-store';
import {
  createMergeResolutionSetArtifactRecord,
  createResolvedMergeAttemptArtifactRecord,
  MERGE_PREVIEW_OBJECT_TYPE,
} from '../../../document/version-store/merge-attempt-artifacts';
import type { ObjectDigest } from '../../../document/version-store/object-digest';
import { versionGraphNamespaceKey } from '../../../document/version-store/object-store';
import {
  createVersionGraphRegistry,
  namespaceForDocumentScope,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import { versionDocumentScopeKey } from '../../../document/version-store/registry';

const DOCUMENT_SCOPE: VersionDocumentScope = { documentId: 'vc08-persisted-merge-recovery' };
const CREATED_AT = '2026-06-23T00:00:00.000Z';

export const BASE = commitId('0');
export const OURS = commitId('1');
export const THEIRS = commitId('2');
export const MERGE = commitId('6');
export const ADVANCED = commitId('7');
export const RESULT_DIGEST = digest('3');
export const TARGET_REF = VERSION_GRAPH_MAIN_REF as VersionMainRefName;
export const EXPECTED_TARGET_HEAD: VersionCommitExpectedHead = {
  commitId: OURS,
  revision: { kind: 'counter', value: '1' },
};

export async function artifactFixture(graphId: string) {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  const resolutionSet = await createMergeResolutionSetArtifactRecord(namespace, []);
  const resolvedAttempt = await createResolvedMergeAttemptArtifactRecord(namespace, {
    resultDigest: RESULT_DIGEST,
    resolutionSetDigest: resolutionSet.digest,
    targetRef: TARGET_REF,
    expectedTargetHead: EXPECTED_TARGET_HEAD,
  });
  const resultId = `merge-result:${RESULT_DIGEST.digest}` as VersionMergeResultId;
  const record: MergeApplyIntentRecord = {
    schemaVersion: 1,
    recordKind: 'mergeApplyIntent',
    intentId: intentIdForResolvedAttemptDigest(resolvedAttempt.digest),
    idempotencyKey: idempotencyKeyForResolvedAttempt({
      resolvedAttemptDigest: resolvedAttempt.digest,
      targetRef: TARGET_REF,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
    }),
    namespaceKey: versionGraphNamespaceKey(namespace),
    documentScopeKey: versionDocumentScopeKey(DOCUMENT_SCOPE),
    applyKind: 'mergeCommit',
    base: BASE,
    ours: OURS,
    theirs: THEIRS,
    targetRef: TARGET_REF,
    expectedTargetHead: EXPECTED_TARGET_HEAD,
    resultDigest: RESULT_DIGEST,
    resolutionSetDigest: resolutionSet.digest,
    resolvedAttemptDigest: resolvedAttempt.digest,
    state: 'staging',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  return {
    namespace,
    resultId,
    resolutionSetDigest: resolutionSet.digest,
    resolvedAttemptDigest: resolvedAttempt.digest,
    record,
  };
}

export function artifactInput() {
  return {
    resultId: `merge-result:${RESULT_DIGEST.digest}` as VersionMergeResultId,
    resultDigest: RESULT_DIGEST,
    previewArtifactDigest: RESULT_DIGEST,
  };
}

export function persistedIntentInput(fixture: Awaited<ReturnType<typeof artifactFixture>>) {
  return {
    resultId: `merge-result:${fixture.resolvedAttemptDigest.digest}` as VersionMergeResultId,
    resultDigest: RESULT_DIGEST,
    resolutionSetDigest: fixture.resolutionSetDigest,
    resolvedAttemptDigest: fixture.resolvedAttemptDigest,
  };
}

export function artifactContext(input: {
  readonly fixture: Awaited<ReturnType<typeof artifactFixture>>;
  readonly record: MergeApplyIntentRecord;
  readonly readRef?: jest.Mock;
  readonly readCommit?: jest.Mock;
  readonly beginIntent?: jest.Mock;
  readonly completeIntent?: jest.Mock;
  readonly mergeCommit?: jest.Mock;
}) {
  const registryPromise = createVersionGraphRegistry({
    documentScope: DOCUMENT_SCOPE,
    graphId: input.fixture.namespace.graphId,
    rootCommitId: BASE,
    createdAt: CREATED_AT,
  });
  const store: MergeApplyIntentStore = {
    namespace: input.fixture.namespace,
    beginIntent: input.beginIntent ?? jest.fn(),
    readByIntentId: jest.fn(),
    readByIdempotencyKey: jest.fn(async () => ({
      status: 'found',
      record: input.record,
      diagnostics: [],
    })),
    readRefCasProof: jest.fn(),
    completeIntent: input.completeIntent ?? jest.fn(),
  };
  return {
    versioning: {
      provider: {
        accessContext: {},
        readGraphRegistry: jest.fn(async () => ({
          status: 'ok',
          registry: await registryPromise,
          diagnostics: [],
        })),
        openGraph: jest.fn(async () => ({
          readRef: input.readRef ?? jest.fn(async () => refReadSuccess(MERGE)),
          readCommit: input.readCommit ?? jest.fn(),
          getObjectRecord: jest.fn(async () => ({
            preimage: {
              objectType: MERGE_PREVIEW_OBJECT_TYPE,
              payload: {
                schemaVersion: 1,
                recordKind: 'mergePreview',
                status: 'clean',
                base: BASE,
                ours: OURS,
                theirs: THEIRS,
                changes: [],
                conflicts: [],
              },
            },
          })),
          putObjects: jest.fn(),
        })),
        openMergeApplyIntentStore: jest.fn(async () => store),
      },
      writeService: {
        mergeCommit: input.mergeCommit ?? jest.fn(),
      },
    },
  } as Parameters<typeof applyPersistedMergeResult>[0];
}

export function persistedIntentContext(input: {
  readonly fixture: Awaited<ReturnType<typeof artifactFixture>>;
  readonly record: MergeApplyIntentRecord;
  readonly readRef: jest.Mock;
  readonly fastForwardMerge: jest.Mock;
}) {
  const registryPromise = createVersionGraphRegistry({
    documentScope: DOCUMENT_SCOPE,
    graphId: input.fixture.namespace.graphId,
    rootCommitId: BASE,
    createdAt: CREATED_AT,
  });
  const store: MergeApplyIntentStore = {
    namespace: input.fixture.namespace,
    beginIntent: jest.fn(),
    readByIntentId: jest.fn(async () => ({
      status: 'found',
      record: input.record,
      diagnostics: [],
    })),
    readByIdempotencyKey: jest.fn(),
    readRefCasProof: jest.fn(),
    completeIntent: jest.fn(),
  };
  return {
    versioning: {
      provider: {
        accessContext: {},
        readGraphRegistry: jest.fn(async () => ({
          status: 'ok',
          registry: await registryPromise,
          diagnostics: [],
        })),
        openGraph: jest.fn(async () => ({ readRef: input.readRef })),
        openMergeApplyIntentStore: jest.fn(async () => store),
      },
      writeService: { fastForwardMerge: input.fastForwardMerge },
    },
  } as Parameters<typeof applyPersistedMergeResult>[0];
}

export function recoveryContext(input: {
  readonly fixture: Awaited<ReturnType<typeof artifactFixture>>;
  readonly record: MergeApplyIntentRecord;
  readonly readRef: jest.Mock;
  readonly readRefCasProof?: jest.Mock;
  readonly completeIntent?: jest.Mock;
}) {
  const registryPromise = createVersionGraphRegistry({
    documentScope: DOCUMENT_SCOPE,
    graphId: input.fixture.namespace.graphId,
    rootCommitId: BASE,
    createdAt: CREATED_AT,
  });
  const store: MergeApplyIntentStore = {
    namespace: input.fixture.namespace,
    beginIntent: jest.fn(),
    readByIntentId: jest.fn(async () => ({
      status: 'found',
      record: input.record,
      diagnostics: [],
    })),
    readByIdempotencyKey: jest.fn(),
    readRefCasProof:
      input.readRefCasProof ??
      jest.fn(async () => ({
        status: 'found',
        proof: await computeMergeApplyRefCasProof({
          applyKind: 'mergeCommit',
          targetRef: TARGET_REF,
          headBefore: OURS,
          headAfter: MERGE,
        }),
        diagnostics: [],
      })),
    completeIntent: input.completeIntent ?? jest.fn(),
  };
  return {
    versioning: {
      provider: {
        accessContext: {},
        readGraphRegistry: jest.fn(async () => ({
          status: 'ok',
          registry: await registryPromise,
          diagnostics: [],
        })),
        openGraph: jest.fn(async () => ({
          readRef: input.readRef,
          readCommit: jest.fn(),
        })),
        openMergeApplyIntentStore: jest.fn(async () => store),
      },
    },
  } as Parameters<typeof recoverPersistedMergeApplyPostCas>[0];
}

export function refReadSuccess(commitId: WorkbookCommitId) {
  return {
    status: 'success' as const,
    ref: {
      name: TARGET_REF,
      commitId,
      revision: { kind: 'counter' as const, value: '2' },
      updatedAt: CREATED_AT,
    },
    diagnostics: [],
  };
}

export function blockedApplyMergeResult(
  base: WorkbookCommitId | null,
  ours: WorkbookCommitId | null,
  theirs: WorkbookCommitId | null,
  diagnostics: readonly VersionStoreDiagnostic[],
  mutationGuarantee: VersionApplyMergeResult['mutationGuarantee'] = 'no-write-attempted',
): VersionApplyMergeResult {
  return {
    status: 'blocked',
    base,
    ours,
    theirs,
    changes: [],
    conflicts: [],
    diagnostics,
    mutationGuarantee,
  };
}

export function staleArtifactResult(
  record: MergeApplyIntentRecord,
  currentHead: WorkbookCommitId,
): VersionApplyMergeResult {
  return {
    resultId: `merge-result:${RESULT_DIGEST.digest}` as VersionMergeResultId,
    previewArtifactDigest: RESULT_DIGEST,
    resultDigest: RESULT_DIGEST,
    resolutionSetDigest: record.resolutionSetDigest,
    resolvedAttemptDigest: record.resolvedAttemptDigest,
    targetRef: record.targetRef,
    headBefore: record.ours,
    headAfter: currentHead,
    status: 'staleTargetHead',
    base: record.base,
    ours: record.ours,
    theirs: record.theirs,
    changes: [],
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'ref-not-mutated',
  };
}

export function intentStoreDiagnostics(
  diagnostics: readonly {
    readonly code: string;
    readonly message: string;
    readonly recoverability: VersionStoreDiagnostic['recoverability'];
  }[],
): readonly VersionStoreDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    issueCode: diagnostic.code,
    severity: 'error',
    recoverability: diagnostic.recoverability,
    messageTemplateId: `version.applyMerge.${diagnostic.code}`,
    safeMessage: diagnostic.message,
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  }));
}

export function providerErrorDiagnostic(): VersionStoreDiagnostic {
  return {
    issueCode: 'VERSION_PROVIDER_FAILED',
    severity: 'error',
    recoverability: 'retry',
    messageTemplateId: 'version.applyMerge.VERSION_PROVIDER_FAILED',
    safeMessage: 'provider failed',
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}

export function resolutionMismatchDiagnostic(safeMessage: string): VersionStoreDiagnostic {
  return {
    issueCode: 'VERSION_MERGE_RESOLUTION_MISMATCH',
    severity: 'error',
    recoverability: 'none',
    messageTemplateId: 'version.applyMerge.VERSION_MERGE_RESOLUTION_MISMATCH',
    safeMessage,
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}

export function expectPublicSafeDiagnostics(
  diagnostics: readonly VersionStoreDiagnostic[],
  forbidden: readonly string[],
) {
  const serialized = JSON.stringify(diagnostics);
  for (const value of forbidden) {
    expect(serialized).not.toContain(value);
  }
  for (const diagnostic of diagnostics) {
    expect(diagnostic.redacted).toBe(true);
    expect(diagnostic.safeMessage).toEqual(expect.any(String));
  }
}

export function commitId(seed: string): WorkbookCommitId {
  return `commit:sha256:${seed.repeat(64)}` as WorkbookCommitId;
}

export function digest(seed: string): ObjectDigest {
  return { algorithm: 'sha256', digest: seed.repeat(64) };
}

export function mutateDigest(value: ObjectDigest): ObjectDigest {
  return {
    algorithm: value.algorithm,
    digest: `${value.digest[0] === '0' ? '1' : '0'}${value.digest.slice(1)}`,
  };
}
