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
import { recoverPersistedMergeApplyPostCas } from '../version-apply-merge-recovery';
import { recoverStagedMergeCommitIfAlreadyApplied } from '../version-apply-merge-persisted-artifact-recovery';
import { VERSION_GRAPH_MAIN_REF } from '../../../document/version-store/graph-store';
import {
  computeMergeApplyRefCasProof,
  type MergeApplyIntentRecord,
  type MergeApplyIntentStore,
} from '../../../document/version-store/merge-apply-intent-store';
import {
  createVersionGraphRegistry,
  namespaceForDocumentScope,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import { versionGraphNamespaceKey } from '../../../document/version-store/object-store';
import { versionDocumentScopeKey } from '../../../document/version-store/registry';

const DOCUMENT_SCOPE: VersionDocumentScope = { documentId: 'vc07-ref-cas-proof' };
const CREATED_AT = '2026-06-21T00:00:00.000Z';
const BASE = commitId('0');
const OURS = commitId('1');
const THEIRS = commitId('2');
const MERGE = commitId('6');
const RESULT_DIGEST = digest('3');
const RESOLVED_ATTEMPT_DIGEST = digest('4');
const RESOLUTION_SET_DIGEST = digest('5');
const RESULT_ID = `merge-result:${RESOLVED_ATTEMPT_DIGEST.digest}` as VersionMergeResultId;
const TARGET_REF = VERSION_GRAPH_MAIN_REF as VersionMainRefName;
const EXPECTED_TARGET_HEAD: VersionCommitExpectedHead = {
  commitId: OURS,
  revision: { kind: 'counter', value: '1' },
};

describe('applyPersistedMergeResult ref CAS proof recovery', () => {
  it('does not finalize an already-moved fast-forward intent without a durable proof row', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'missing-ref-cas-proof');
    const registry = await createVersionGraphRegistry({
      documentScope: DOCUMENT_SCOPE,
      graphId: namespace.graphId,
      rootCommitId: BASE,
      createdAt: CREATED_AT,
    });
    const completeIntent = jest.fn();
    const store: MergeApplyIntentStore = {
      namespace,
      beginIntent: jest.fn(),
      readByIntentId: jest.fn(async () => ({
        status: 'found',
        record: fastForwardIntentRecord(namespace),
        diagnostics: [],
      })),
      readByIdempotencyKey: jest.fn(),
      readRefCasProof: jest.fn(async () => ({
        status: 'missing',
        proof: null,
        diagnostics: [
          {
            code: 'VERSION_INTENT_NOT_FOUND',
            message: 'proof missing',
            recoverability: 'repair',
          },
        ],
      })),
      completeIntent,
    };
    const provider = {
      accessContext: {},
      readGraphRegistry: jest.fn(async () => ({
        status: 'ok',
        registry,
        diagnostics: [],
      })),
      openGraph: jest.fn(async () => ({
        readRef: jest.fn(async () => ({
          status: 'success',
          ref: {
            name: TARGET_REF,
            commitId: THEIRS,
            revision: { kind: 'counter', value: '2' },
            updatedAt: CREATED_AT,
          },
          diagnostics: [],
        })),
      })),
      openMergeApplyIntentStore: jest.fn(async () => store),
    };

    const result = await applyPersistedMergeResult(
      { versioning: { provider } } as Parameters<typeof applyPersistedMergeResult>[0],
      { resultId: RESULT_ID, resultDigest: RESULT_DIGEST },
      { targetRef: TARGET_REF, expectedTargetHead: EXPECTED_TARGET_HEAD },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      mutationGuarantee: 'ref-not-mutated',
      diagnostics: [
        {
          issueCode: 'VERSION_INTENT_NOT_FOUND',
          recoverability: 'repair',
        },
      ],
    });
    expect(completeIntent).not.toHaveBeenCalled();
  });
});

describe('recoverStagedMergeCommitIfAlreadyApplied ref CAS proof recovery', () => {
  it('does not finalize an already-moved mergeCommit intent without a durable proof row', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'missing-merge-proof');
    const record = mergeCommitIntentRecord(namespace);
    const completeIntent = jest.fn();
    const store: MergeApplyIntentStore = {
      namespace,
      beginIntent: jest.fn(),
      readByIntentId: jest.fn(async () => ({ status: 'found', record, diagnostics: [] })),
      readByIdempotencyKey: jest.fn(),
      readRefCasProof: jest.fn(async () => ({
        status: 'missing',
        proof: null,
        diagnostics: [
          {
            code: 'VERSION_INTENT_NOT_FOUND',
            message: 'merge proof missing',
            recoverability: 'repair',
          },
        ],
      })),
      completeIntent,
    };

    const result = await recoverStagedMergeCommitIfAlreadyApplied({
      graph: {
        readCommit: jest.fn(async () => ({
          status: 'success',
          commit: {
            payload: {
              parentCommitIds: [OURS, THEIRS],
              resolvedMergeAttemptDigest: RESOLVED_ATTEMPT_DIGEST,
            },
          },
          diagnostics: [],
        })),
      } as any,
      store,
      input: {
        resultId: RESULT_ID,
        resultDigest: RESULT_DIGEST,
        resolutionSetDigest: RESOLUTION_SET_DIGEST,
        resolvedAttemptDigest: RESOLVED_ATTEMPT_DIGEST,
        resolutions: [],
      },
      record,
      readCurrentTargetHead: jest.fn(async () => ({ ok: true, commitId: MERGE })),
      resultFromTerminalArtifactIntent: jest.fn(),
      staleTargetHeadArtifactResult: jest.fn(),
      blockedApplyMergeResult,
      mapProviderDiagnostics: jest.fn(),
      providerErrorDiagnostic: providerErrorDiagnosticForTest,
      intentStoreDiagnostics,
      resolutionMismatchDiagnostic: resolutionMismatchDiagnosticForTest,
    });

    expect(result).toMatchObject({
      status: 'blocked',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      mutationGuarantee: 'ref-not-mutated',
      diagnostics: [
        {
          issueCode: 'VERSION_INTENT_NOT_FOUND',
          recoverability: 'repair',
        },
      ],
    });
    expect(completeIntent).not.toHaveBeenCalled();
  });
});

describe('recoverPersistedMergeApplyPostCas', () => {
  it('finalizes an already-moved fast-forward intent under the merge kill switch without write services', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'internal-fast-forward-recovery');
    const record = fastForwardIntentRecord(namespace);
    const completeIntent = jest.fn(async (input: Parameters<MergeApplyIntentStore['completeIntent']>[0]) => ({
      status: 'completed' as const,
      record: { ...record, state: 'finalized' as const, terminal: input.terminal },
      diagnostics: [],
    }));
    const fastForwardMerge = jest.fn();
    const mergeCommit = jest.fn();

    const result = await recoverPersistedMergeApplyPostCas(
      recoveryContext({
        namespace,
        record,
        head: THEIRS,
        proof: await computeMergeApplyRefCasProof({
          applyKind: 'fastForward',
          targetRef: TARGET_REF,
          headBefore: OURS,
          headAfter: THEIRS,
        }),
        completeIntent,
        fastForwardMerge,
        mergeCommit,
      }),
      { resultId: RESULT_ID, resultDigest: RESULT_DIGEST },
    );

    expect(result).toMatchObject({
      status: 'alreadyApplied',
      commitRef: { id: THEIRS, refName: TARGET_REF },
      mutationGuarantee: 'ref-not-mutated',
    });
    expect(completeIntent).toHaveBeenCalledTimes(1);
    expect(fastForwardMerge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });

  it('does not mutate when the fast-forward ref CAS is not visible', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'internal-fast-forward-not-moved');
    const record = fastForwardIntentRecord(namespace);
    const completeIntent = jest.fn();
    const fastForwardMerge = jest.fn();

    const result = await recoverPersistedMergeApplyPostCas(
      recoveryContext({
        namespace,
        record,
        head: OURS,
        completeIntent,
        fastForwardMerge,
      }),
      { resultId: RESULT_ID, resultDigest: RESULT_DIGEST },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_MERGE_RECOVERY_NOT_READY' })],
    });
    expect(completeIntent).not.toHaveBeenCalled();
    expect(fastForwardMerge).not.toHaveBeenCalled();
  });

  it('finalizes an already-moved mergeCommit intent under the merge kill switch without write services', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'internal-merge-commit-recovery');
    const record = mergeCommitIntentRecord(namespace);
    const completeIntent = jest.fn(async (input: Parameters<MergeApplyIntentStore['completeIntent']>[0]) => ({
      status: 'completed' as const,
      record: { ...record, state: 'finalized' as const, terminal: input.terminal },
      diagnostics: [],
    }));
    const mergeCommit = jest.fn();

    const result = await recoverPersistedMergeApplyPostCas(
      recoveryContext({
        namespace,
        record,
        head: MERGE,
        mergeCommitPayload: {
          parentCommitIds: [OURS, THEIRS],
          resolvedMergeAttemptDigest: RESOLVED_ATTEMPT_DIGEST,
        },
        proof: await computeMergeApplyRefCasProof({
          applyKind: 'mergeCommit',
          targetRef: TARGET_REF,
          headBefore: OURS,
          headAfter: MERGE,
        }),
        completeIntent,
        mergeCommit,
      }),
      { resolvedAttemptDigest: RESOLVED_ATTEMPT_DIGEST, resultDigest: RESULT_DIGEST },
    );

    expect(result).toMatchObject({
      status: 'alreadyApplied',
      commitRef: { id: MERGE, refName: TARGET_REF },
      mutationGuarantee: 'ref-not-mutated',
    });
    expect(completeIntent).toHaveBeenCalledTimes(1);
    expect(mergeCommit).not.toHaveBeenCalled();
  });
});

function fastForwardIntentRecord(
  namespace: ReturnType<typeof namespaceForDocumentScope>,
): MergeApplyIntentRecord {
  return mergeApplyIntentRecord(namespace, 'fastForward');
}

function mergeCommitIntentRecord(
  namespace: ReturnType<typeof namespaceForDocumentScope>,
): MergeApplyIntentRecord {
  return mergeApplyIntentRecord(namespace, 'mergeCommit');
}

function mergeApplyIntentRecord(
  namespace: ReturnType<typeof namespaceForDocumentScope>,
  applyKind: MergeApplyIntentRecord['applyKind'],
): MergeApplyIntentRecord {
  return {
    schemaVersion: 1,
    recordKind: 'mergeApplyIntent',
    intentId: `merge-apply-intent:sha256:${RESOLVED_ATTEMPT_DIGEST.digest}`,
    idempotencyKey: 'merge-apply:missing-proof',
    namespaceKey: versionGraphNamespaceKey(namespace),
    documentScopeKey: versionDocumentScopeKey(DOCUMENT_SCOPE),
    applyKind,
    base: BASE,
    ours: OURS,
    theirs: THEIRS,
    targetRef: TARGET_REF,
    expectedTargetHead: EXPECTED_TARGET_HEAD,
    resultDigest: RESULT_DIGEST,
    resolutionSetDigest: RESOLUTION_SET_DIGEST,
    resolvedAttemptDigest: RESOLVED_ATTEMPT_DIGEST,
    state: 'staging',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function recoveryContext(input: {
  readonly namespace: ReturnType<typeof namespaceForDocumentScope>;
  readonly record: MergeApplyIntentRecord;
  readonly head: WorkbookCommitId;
  readonly proof?: Awaited<ReturnType<typeof computeMergeApplyRefCasProof>>;
  readonly mergeCommitPayload?: {
    readonly parentCommitIds: readonly WorkbookCommitId[];
    readonly resolvedMergeAttemptDigest?: ReturnType<typeof digest>;
  };
  readonly completeIntent: MergeApplyIntentStore['completeIntent'];
  readonly fastForwardMerge?: jest.Mock;
  readonly mergeCommit?: jest.Mock;
}) {
  const registryPromise = createVersionGraphRegistry({
    documentScope: DOCUMENT_SCOPE,
    graphId: input.namespace.graphId,
    rootCommitId: BASE,
    createdAt: CREATED_AT,
  });
  const store: MergeApplyIntentStore = {
    namespace: input.namespace,
    beginIntent: jest.fn(),
    readByIntentId: jest.fn(async () => ({
      status: 'found',
      record: input.record,
      diagnostics: [],
    })),
    readByIdempotencyKey: jest.fn(),
    readRefCasProof: jest.fn(async () =>
      input.proof
        ? { status: 'found', proof: input.proof, diagnostics: [] }
        : {
            status: 'missing',
            proof: null,
            diagnostics: [
              {
                code: 'VERSION_INTENT_NOT_FOUND',
                message: 'proof missing',
                recoverability: 'repair',
              },
            ],
          },
    ),
    completeIntent: input.completeIntent,
  };
  return {
    versioning: {
      versionControlMergeKillSwitch: true,
      provider: {
        accessContext: {},
        readGraphRegistry: jest.fn(async () => ({
          status: 'ok',
          registry: await registryPromise,
          diagnostics: [],
        })),
        openGraph: jest.fn(async () => ({
          readRef: jest.fn(async () => ({
            status: 'success',
            ref: {
              name: TARGET_REF,
              commitId: input.head,
              revision: { kind: 'counter', value: '2' },
              updatedAt: CREATED_AT,
            },
            diagnostics: [],
          })),
          readCommit: jest.fn(async () => ({
            status: 'success',
            commit: { payload: input.mergeCommitPayload ?? { parentCommitIds: [] } },
            diagnostics: [],
          })),
        })),
        openMergeApplyIntentStore: jest.fn(async () => store),
      },
      writeService: {
        fastForwardMerge: input.fastForwardMerge ?? jest.fn(),
        mergeCommit: input.mergeCommit ?? jest.fn(),
      },
    },
  } as Parameters<typeof recoverPersistedMergeApplyPostCas>[0];
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

function providerErrorDiagnosticForTest(): VersionStoreDiagnostic {
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

function resolutionMismatchDiagnosticForTest(safeMessage: string): VersionStoreDiagnostic {
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

function commitId(seed: string): WorkbookCommitId {
  return `commit:sha256:${seed.repeat(64)}` as WorkbookCommitId;
}

function digest(seed: string) {
  return { algorithm: 'sha256' as const, digest: seed.repeat(64) };
}
