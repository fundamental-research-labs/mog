import { jest } from '@jest/globals';

import type {
  VersionApplyMergeResult,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeResultId,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { applyPersistedMergeResult } from '../version-apply-merge-persisted';
import { recoverStagedMergeCommitIfAlreadyApplied } from '../version-apply-merge-persisted-artifact-recovery';
import { recoverPersistedMergeApplyPostCas } from '../version-apply-merge-recovery';
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
import {
  createVersionGraphRegistry,
  namespaceForDocumentScope,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import type { ObjectDigest } from '../../../document/version-store/object-digest';
import { versionGraphNamespaceKey } from '../../../document/version-store/object-store';
import { versionDocumentScopeKey } from '../../../document/version-store/registry';

const DOCUMENT_SCOPE: VersionDocumentScope = { documentId: 'vc08-persisted-merge-recovery' };
const CREATED_AT = '2026-06-23T00:00:00.000Z';
const BASE = commitId('0');
const OURS = commitId('1');
const THEIRS = commitId('2');
const MERGE = commitId('6');
const ADVANCED = commitId('7');
const RESULT_DIGEST = digest('3');
const TARGET_REF = VERSION_GRAPH_MAIN_REF as VersionMainRefName;
const EXPECTED_TARGET_HEAD: VersionCommitExpectedHead = {
  commitId: OURS,
  revision: { kind: 'counter', value: '1' },
};

describe('persisted applyMerge artifact recovery hardening', () => {
  it('blocks terminal artifact replay when the stored intent digest identity mismatches', async () => {
    const fixture = await artifactFixture('terminal-digest-mismatch');
    const record: MergeApplyIntentRecord = {
      ...fixture.record,
      resultDigest: mutateDigest(RESULT_DIGEST),
      state: 'finalized',
      terminal: {
        status: 'applied',
        headBefore: OURS,
        headAfter: MERGE,
        commitId: MERGE,
      },
    };
    const readRef = jest.fn();
    const beginIntent = jest.fn();

    const result = await applyPersistedMergeResult(
      artifactContext({ fixture, record, readRef, beginIntent }),
      artifactInput(),
      { targetRef: TARGET_REF, expectedTargetHead: EXPECTED_TARGET_HEAD },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_MERGE_RESOLUTION_MISMATCH',
          safeMessage: 'persisted merge resultDigest does not match the resolved artifact.',
          redacted: true,
        }),
      ],
    });
    expectPublicSafeDiagnostics(result.diagnostics, [RESULT_DIGEST.digest, MERGE]);
    expect(readRef).not.toHaveBeenCalled();
    expect(beginIntent).not.toHaveBeenCalled();
  });

  it('returns staleTargetHead when terminal artifact replay no longer owns the target ref', async () => {
    const fixture = await artifactFixture('terminal-stale-replay');
    const record: MergeApplyIntentRecord = {
      ...fixture.record,
      state: 'finalized',
      terminal: {
        status: 'applied',
        headBefore: OURS,
        headAfter: MERGE,
        commitId: MERGE,
      },
    };
    const readRef = jest.fn(async () => refReadSuccess(ADVANCED));
    const mergeCommit = jest.fn();

    const result = await applyPersistedMergeResult(
      artifactContext({ fixture, record, readRef, mergeCommit }),
      artifactInput(),
      { targetRef: TARGET_REF, expectedTargetHead: EXPECTED_TARGET_HEAD },
    );

    expect(result).toMatchObject({
      status: 'staleTargetHead',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      resultId: fixture.resultId,
      resultDigest: RESULT_DIGEST,
      previewArtifactDigest: RESULT_DIGEST,
      resolutionSetDigest: fixture.resolutionSetDigest,
      resolvedAttemptDigest: fixture.resolvedAttemptDigest,
      targetRef: TARGET_REF,
      headBefore: OURS,
      headAfter: ADVANCED,
      diagnostics: [],
      mutationGuarantee: 'ref-not-mutated',
    });
    expect(result).not.toHaveProperty('commitRef');
    expect(readRef).toHaveBeenCalledWith(TARGET_REF);
    expect(mergeCommit).not.toHaveBeenCalled();
  });

  it('does not recover a staged artifact intent from a non-matching merge commit', async () => {
    const fixture = await artifactFixture('non-matching-merge-commit');
    const completeIntent = jest.fn();
    const readRefCasProof = jest.fn();
    const staleTargetHeadArtifactResult = jest.fn(
      (_input, record: MergeApplyIntentRecord, currentHead: WorkbookCommitId) =>
        staleArtifactResult(record, currentHead),
    );

    const result = await recoverStagedMergeCommitIfAlreadyApplied({
      graph: {
        readCommit: jest.fn(async () => ({
          status: 'success',
          commit: {
            payload: {
              parentCommitIds: [OURS, THEIRS],
              resolvedMergeAttemptDigest: mutateDigest(fixture.resolvedAttemptDigest),
            },
          },
          diagnostics: [],
        })),
      } as any,
      store: {
        namespace: fixture.namespace,
        beginIntent: jest.fn(),
        readByIntentId: jest.fn(),
        readByIdempotencyKey: jest.fn(),
        readRefCasProof,
        completeIntent,
      },
      input: {
        resultId: fixture.resultId,
        resultDigest: RESULT_DIGEST,
        previewArtifactDigest: RESULT_DIGEST,
        resolutionSetDigest: fixture.resolutionSetDigest,
        resolvedAttemptDigest: fixture.resolvedAttemptDigest,
        resolutions: [],
      },
      record: fixture.record,
      readCurrentTargetHead: jest.fn(async () => ({ ok: true, commitId: MERGE })),
      resultFromTerminalArtifactIntent: jest.fn(),
      staleTargetHeadArtifactResult,
      blockedApplyMergeResult,
      mapProviderDiagnostics: jest.fn(),
      providerErrorDiagnostic,
      intentStoreDiagnostics,
      resolutionMismatchDiagnostic,
    });

    expect(result).toMatchObject({
      status: 'staleTargetHead',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      headAfter: MERGE,
      diagnostics: [],
      mutationGuarantee: 'ref-not-mutated',
    });
    expect(staleTargetHeadArtifactResult).toHaveBeenCalledTimes(1);
    expect(readRefCasProof).not.toHaveBeenCalled();
    expect(completeIntent).not.toHaveBeenCalled();
  });

  it('keeps post-CAS recovery provider diagnostics public-safe', async () => {
    const fixture = await artifactFixture('public-safe-recovery-diagnostics');
    const rawCommit = commitId('9');
    const rawDigest = digest('8').digest;
    const result = await recoverPersistedMergeApplyPostCas(
      recoveryContext({
        fixture,
        record: fixture.record,
        readRef: jest.fn(async () => ({
          status: 'degraded',
          ref: null,
          diagnostics: [
            {
              issueCode: 'VERSION_PERMISSION_DENIED',
              safeMessage: `Denied ${rawCommit} sha256:${rawDigest}`,
              message: `Denied ${rawCommit} sha256:${rawDigest}`,
              recoverability: 'retry',
            },
          ],
        })),
      }),
      { resolvedAttemptDigest: fixture.resolvedAttemptDigest, resultDigest: RESULT_DIGEST },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_PERMISSION_DENIED',
          safeMessage:
            'Version applyMerge recovery provider denied access to required version data.',
          redacted: true,
        }),
      ],
    });
    expectPublicSafeDiagnostics(result.diagnostics, [rawCommit, rawDigest, `sha256:${rawDigest}`]);
  });

  it('keeps terminal artifact read diagnostics public-safe', async () => {
    const fixture = await artifactFixture('public-safe-artifact-diagnostics');
    const rawCommit = commitId('a');
    const rawDigest = digest('b').digest;
    const record: MergeApplyIntentRecord = {
      ...fixture.record,
      state: 'finalized',
      terminal: {
        status: 'applied',
        headBefore: OURS,
        headAfter: MERGE,
        commitId: MERGE,
      },
    };

    const result = await applyPersistedMergeResult(
      artifactContext({
        fixture,
        record,
        readRef: jest.fn(async () => ({
          status: 'degraded',
          ref: null,
          diagnostics: [
            {
              issueCode: 'VERSION_PERMISSION_DENIED',
              safeMessage: `Denied ${rawCommit} sha256:${rawDigest}`,
              message: `Denied ${rawCommit} sha256:${rawDigest}`,
              recoverability: 'retry',
            },
          ],
        })),
      }),
      artifactInput(),
      { targetRef: TARGET_REF, expectedTargetHead: EXPECTED_TARGET_HEAD },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_PERMISSION_DENIED',
          safeMessage: 'Version applyMerge provider denied access to required version data.',
          redacted: true,
        }),
      ],
    });
    expectPublicSafeDiagnostics(result.diagnostics, [rawCommit, rawDigest, `sha256:${rawDigest}`]);
  });
});

async function artifactFixture(graphId: string) {
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

function artifactInput() {
  return {
    resultId: `merge-result:${RESULT_DIGEST.digest}` as VersionMergeResultId,
    resultDigest: RESULT_DIGEST,
    previewArtifactDigest: RESULT_DIGEST,
  };
}

function artifactContext(input: {
  readonly fixture: Awaited<ReturnType<typeof artifactFixture>>;
  readonly record: MergeApplyIntentRecord;
  readonly readRef?: jest.Mock;
  readonly beginIntent?: jest.Mock;
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
        openGraph: jest.fn(async () => ({
          readRef: input.readRef ?? jest.fn(async () => refReadSuccess(MERGE)),
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

function recoveryContext(input: {
  readonly fixture: Awaited<ReturnType<typeof artifactFixture>>;
  readonly record: MergeApplyIntentRecord;
  readonly readRef: jest.Mock;
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
    readRefCasProof: jest.fn(async () => ({
      status: 'found',
      proof: await computeMergeApplyRefCasProof({
        applyKind: 'mergeCommit',
        targetRef: TARGET_REF,
        headBefore: OURS,
        headAfter: MERGE,
      }),
      diagnostics: [],
    })),
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
        openGraph: jest.fn(async () => ({
          readRef: input.readRef,
          readCommit: jest.fn(),
        })),
        openMergeApplyIntentStore: jest.fn(async () => store),
      },
    },
  } as Parameters<typeof recoverPersistedMergeApplyPostCas>[0];
}

function refReadSuccess(commitId: WorkbookCommitId) {
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

function blockedApplyMergeResult(
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

function staleArtifactResult(
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

function intentStoreDiagnostics(
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

function providerErrorDiagnostic(): VersionStoreDiagnostic {
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

function resolutionMismatchDiagnostic(safeMessage: string): VersionStoreDiagnostic {
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

function expectPublicSafeDiagnostics(
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

function commitId(seed: string): WorkbookCommitId {
  return `commit:sha256:${seed.repeat(64)}` as WorkbookCommitId;
}

function digest(seed: string): ObjectDigest {
  return { algorithm: 'sha256', digest: seed.repeat(64) };
}

function mutateDigest(value: ObjectDigest): ObjectDigest {
  return {
    algorithm: value.algorithm,
    digest: `${value.digest[0] === '0' ? '1' : '0'}${value.digest.slice(1)}`,
  };
}
