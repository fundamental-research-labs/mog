import { jest } from '@jest/globals';

import type {
  VersionApplyMergeResult,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeResult,
  VersionMergeResultId,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { applyMergeWorkbookVersion } from '../version-apply-merge';
import { applyPersistedMergeResult } from '../version-apply-merge-persisted';
import { recoverPersistedMergeApplyPostCas } from '../version-apply-merge-recovery';
import { recoverStagedMergeCommitIfAlreadyApplied } from '../version-apply-merge-persisted-artifact-recovery';
import { versionDomainSupportManifestRuntime } from './version-domain-support-test-utils';
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
const ADVANCED = commitId('7');
const RESULT_DIGEST = digest('3');
const RESOLVED_ATTEMPT_DIGEST = digest('4');
const RESOLUTION_SET_DIGEST = digest('5');
const RESULT_ID = `merge-result:${RESOLVED_ATTEMPT_DIGEST.digest}` as VersionMergeResultId;
const TARGET_REF = VERSION_GRAPH_MAIN_REF as VersionMainRefName;
const EXPECTED_TARGET_HEAD: VersionCommitExpectedHead = {
  commitId: OURS,
  revision: { kind: 'counter', value: '1' },
};

describe('applyMergeWorkbookVersion target-ref CAS proof validation', () => {
  it('fails closed before fast-forward writes when the concrete target head is stale', async () => {
    const fastForwardMerge = jest.fn();
    const ctx = await publicApplyContext({
      targetCommitId: THEIRS,
      targetRevision: { kind: 'counter', value: '2' },
      fastForwardMerge,
    });

    const result = await applyMergeWorkbookVersion(
      ctx,
      { base: BASE, ours: OURS, theirs: THEIRS },
      { targetRef: TARGET_REF, expectedTargetHead: EXPECTED_TARGET_HEAD },
    );

    expect(result).toMatchObject({
      status: 'staleTargetHead',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      mutationGuarantee: 'ref-not-mutated',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_REF_CONFLICT',
          recoverability: 'retry',
          payload: expect.objectContaining({
            operation: 'applyMerge',
            reason: 'staleTargetHead',
            targetRef: TARGET_REF,
            expectedHead: OURS,
            actualHead: THEIRS,
          }),
        }),
      ],
    });
    expect(fastForwardMerge).not.toHaveBeenCalled();
  });

  it('fails closed before writes when targetRef mismatches the current symbolic HEAD target', async () => {
    const fastForwardMerge = jest.fn();
    const expectedTargetHead: VersionCommitExpectedHead = {
      ...EXPECTED_TARGET_HEAD,
      symbolicHeadRevision: { kind: 'counter', value: 'head-1' },
    };
    const ctx = await publicApplyContext({
      symbolicTarget: 'refs/heads/scenario/current' as VersionRefName,
      symbolicRevision: expectedTargetHead.symbolicHeadRevision,
      fastForwardMerge,
    });

    const result = await applyMergeWorkbookVersion(
      ctx,
      { base: BASE, ours: OURS, theirs: THEIRS },
      { targetRef: TARGET_REF, expectedTargetHead },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_REF_CONFLICT',
          recoverability: 'retry',
          payload: expect.objectContaining({
            operation: 'applyMerge',
            reason: 'symbolicTargetMismatch',
            expectedTargetRef: TARGET_REF,
            actualTargetRef: 'refs/heads/scenario/current',
          }),
        }),
      ],
    });
    expect(fastForwardMerge).not.toHaveBeenCalled();
  });

  it('fails closed before writes when symbolicHeadRevision is stale', async () => {
    const mergeCommit = jest.fn();
    const merge = jest.fn(async (): Promise<VersionMergeResult> => cleanMergePreview());
    const ctx = await publicApplyContext({
      symbolicRevision: { kind: 'counter', value: 'head-2' },
      merge,
      mergeCommit,
    });

    const result = await applyMergeWorkbookVersion(
      ctx,
      { base: BASE, ours: OURS, theirs: THEIRS },
      {
        targetRef: TARGET_REF,
        expectedTargetHead: {
          ...EXPECTED_TARGET_HEAD,
          symbolicHeadRevision: { kind: 'counter', value: 'head-1' },
        },
      },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_REF_CONFLICT',
          recoverability: 'retry',
          payload: expect.objectContaining({
            operation: 'applyMerge',
            reason: 'staleSymbolicHead',
            targetRef: TARGET_REF,
            expectedRevision: 'head-1',
            actualRevision: 'head-2',
          }),
        }),
      ],
    });
    expect(merge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });
});

describe('applyPersistedMergeResult ref CAS proof recovery', () => {
  it('returns terminal fast-forward idempotency before stale-target rejection', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'terminal-before-stale');
    const registry = await createVersionGraphRegistry({
      documentScope: DOCUMENT_SCOPE,
      graphId: namespace.graphId,
      rootCommitId: BASE,
      createdAt: CREATED_AT,
    });
    const record: MergeApplyIntentRecord = {
      ...fastForwardIntentRecord(namespace),
      state: 'finalized',
      terminal: {
        status: 'fastForwarded',
        headBefore: OURS,
        headAfter: THEIRS,
        commitId: THEIRS,
      },
    };
    const fastForwardMerge = jest.fn();
    const store: MergeApplyIntentStore = {
      namespace,
      beginIntent: jest.fn(),
      readByIntentId: jest.fn(async () => ({ status: 'found', record, diagnostics: [] })),
      readByIdempotencyKey: jest.fn(),
      readRefCasProof: jest.fn(),
      completeIntent: jest.fn(),
    };
    const readRef = jest.fn(async () => ({
      status: 'success' as const,
      ref: {
        name: TARGET_REF,
        commitId: THEIRS,
        revision: { kind: 'counter' as const, value: '2' },
        updatedAt: CREATED_AT,
      },
      diagnostics: [],
    }));
    const provider = {
      accessContext: {},
      readGraphRegistry: jest.fn(async () => ({
        status: 'ok',
        registry,
        diagnostics: [],
      })),
      openGraph: jest.fn(async () => ({ readRef })),
      openMergeApplyIntentStore: jest.fn(async () => store),
    };

    const result = await applyPersistedMergeResult(
      {
        versioning: {
          provider,
          writeService: { fastForwardMerge },
        },
      } as Parameters<typeof applyPersistedMergeResult>[0],
      { resultId: RESULT_ID, resultDigest: RESULT_DIGEST },
      { targetRef: TARGET_REF, expectedTargetHead: EXPECTED_TARGET_HEAD },
    );

    expect(result).toMatchObject({
      status: 'alreadyApplied',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      commitRef: { id: THEIRS, refName: TARGET_REF },
      resultId: RESULT_ID,
      resultDigest: RESULT_DIGEST,
      resolutionSetDigest: RESOLUTION_SET_DIGEST,
      resolvedAttemptDigest: RESOLVED_ATTEMPT_DIGEST,
      targetRef: TARGET_REF,
      headBefore: OURS,
      headAfter: THEIRS,
      mutationGuarantee: 'ref-not-mutated',
    });
    expect(readRef).toHaveBeenCalledWith(TARGET_REF);
    expect(fastForwardMerge).not.toHaveBeenCalled();
    expect(store.readRefCasProof).not.toHaveBeenCalled();
    expect(store.completeIntent).not.toHaveBeenCalled();
  });

  it('returns staleTargetHead for terminal alreadyApplied replay after the target advances', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'terminal-already-applied-stale');
    const registry = await createVersionGraphRegistry({
      documentScope: DOCUMENT_SCOPE,
      graphId: namespace.graphId,
      rootCommitId: BASE,
      createdAt: CREATED_AT,
    });
    const record: MergeApplyIntentRecord = {
      ...fastForwardIntentRecord(namespace),
      state: 'finalized',
      terminal: {
        status: 'alreadyApplied',
        headBefore: OURS,
        headAfter: THEIRS,
        commitId: THEIRS,
      },
    };
    const fastForwardMerge = jest.fn();
    const store: MergeApplyIntentStore = {
      namespace,
      beginIntent: jest.fn(),
      readByIntentId: jest.fn(async () => ({ status: 'found', record, diagnostics: [] })),
      readByIdempotencyKey: jest.fn(),
      readRefCasProof: jest.fn(),
      completeIntent: jest.fn(),
    };
    const readRef = jest.fn(async () => ({
      status: 'success' as const,
      ref: {
        name: TARGET_REF,
        commitId: ADVANCED,
        revision: { kind: 'counter' as const, value: '3' },
        updatedAt: CREATED_AT,
      },
      diagnostics: [],
    }));
    const provider = {
      accessContext: {},
      readGraphRegistry: jest.fn(async () => ({
        status: 'ok',
        registry,
        diagnostics: [],
      })),
      openGraph: jest.fn(async () => ({ readRef })),
      openMergeApplyIntentStore: jest.fn(async () => store),
    };

    const result = await applyPersistedMergeResult(
      {
        versioning: {
          provider,
          writeService: { fastForwardMerge },
        },
      } as Parameters<typeof applyPersistedMergeResult>[0],
      { resultId: RESULT_ID, resultDigest: RESULT_DIGEST },
      { targetRef: TARGET_REF, expectedTargetHead: EXPECTED_TARGET_HEAD },
    );

    expect(result).toMatchObject({
      status: 'staleTargetHead',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      resultId: RESULT_ID,
      resultDigest: RESULT_DIGEST,
      resolutionSetDigest: RESOLUTION_SET_DIGEST,
      resolvedAttemptDigest: RESOLVED_ATTEMPT_DIGEST,
      targetRef: TARGET_REF,
      headBefore: OURS,
      headAfter: ADVANCED,
      mutationGuarantee: 'ref-not-mutated',
    });
    expect(result).not.toHaveProperty('commitRef');
    expect(readRef).toHaveBeenCalledWith(TARGET_REF);
    expect(fastForwardMerge).not.toHaveBeenCalled();
    expect(store.readRefCasProof).not.toHaveBeenCalled();
    expect(store.completeIntent).not.toHaveBeenCalled();
  });

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

  it('blocks malformed persisted intents whose expected head is not the stored ours commit', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'malformed-expected-head');
    const registry = await createVersionGraphRegistry({
      documentScope: DOCUMENT_SCOPE,
      graphId: namespace.graphId,
      rootCommitId: BASE,
      createdAt: CREATED_AT,
    });
    const malformedExpectedHead: VersionCommitExpectedHead = {
      ...EXPECTED_TARGET_HEAD,
      commitId: BASE,
    };
    const record = {
      ...fastForwardIntentRecord(namespace),
      expectedTargetHead: malformedExpectedHead,
    };
    const fastForwardMerge = jest.fn();
    const store: MergeApplyIntentStore = {
      namespace,
      beginIntent: jest.fn(),
      readByIntentId: jest.fn(async () => ({ status: 'found', record, diagnostics: [] })),
      readByIdempotencyKey: jest.fn(),
      readRefCasProof: jest.fn(),
      completeIntent: jest.fn(),
    };
    const openGraph = jest.fn();
    const provider = {
      accessContext: {},
      readGraphRegistry: jest.fn(async () => ({
        status: 'ok',
        registry,
        diagnostics: [],
      })),
      openGraph,
      openMergeApplyIntentStore: jest.fn(async () => store),
    };

    const result = await applyPersistedMergeResult(
      {
        versioning: {
          provider,
          writeService: { fastForwardMerge },
        },
      } as Parameters<typeof applyPersistedMergeResult>[0],
      { resultId: RESULT_ID, resultDigest: RESULT_DIGEST },
      { targetRef: TARGET_REF, expectedTargetHead: malformedExpectedHead },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [
        {
          issueCode: 'VERSION_MERGE_RESOLUTION_MISMATCH',
          recoverability: 'none',
        },
      ],
    });
    expect(openGraph).not.toHaveBeenCalled();
    expect(fastForwardMerge).not.toHaveBeenCalled();
    expect(store.readRefCasProof).not.toHaveBeenCalled();
    expect(store.completeIntent).not.toHaveBeenCalled();
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
    const completeIntent = jest.fn(
      async (input: Parameters<MergeApplyIntentStore['completeIntent']>[0]) => ({
        status: 'completed' as const,
        record: { ...record, state: 'finalized' as const, terminal: input.terminal },
        diagnostics: [],
      }),
    );
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
    const completeIntent = jest.fn(
      async (input: Parameters<MergeApplyIntentStore['completeIntent']>[0]) => ({
        status: 'completed' as const,
        record: { ...record, state: 'finalized' as const, terminal: input.terminal },
        diagnostics: [],
      }),
    );
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

async function publicApplyContext(input: {
  readonly targetCommitId?: WorkbookCommitId;
  readonly targetRevision?: VersionCommitExpectedHead['revision'];
  readonly symbolicTarget?: VersionMainRefName | VersionRefName;
  readonly symbolicRevision?: VersionCommitExpectedHead['revision'];
  readonly fastForwardMerge?: jest.Mock;
  readonly mergeCommit?: jest.Mock;
  readonly merge?: jest.Mock;
}): Promise<Parameters<typeof applyMergeWorkbookVersion>[0]> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'public-apply-target-ref-cas');
  const registry = await createVersionGraphRegistry({
    documentScope: DOCUMENT_SCOPE,
    graphId: namespace.graphId,
    rootCommitId: BASE,
    createdAt: CREATED_AT,
  });
  const targetCommitId = input.targetCommitId ?? EXPECTED_TARGET_HEAD.commitId;
  const targetRevision = input.targetRevision ?? EXPECTED_TARGET_HEAD.revision;
  const symbolicTarget = input.symbolicTarget ?? TARGET_REF;
  const symbolicRevision =
    input.symbolicRevision ?? EXPECTED_TARGET_HEAD.symbolicHeadRevision ?? targetRevision;
  const readRef = jest.fn(async (name: string) => {
    if (name === 'HEAD') {
      return {
        status: 'success' as const,
        ref: {
          name: 'HEAD' as const,
          target: symbolicTarget,
          revision: symbolicRevision,
        },
        diagnostics: [],
      };
    }
    if (name === TARGET_REF) {
      return {
        status: 'success' as const,
        ref: {
          name: TARGET_REF,
          commitId: targetCommitId,
          revision: targetRevision,
          updatedAt: CREATED_AT,
        },
        diagnostics: [],
      };
    }
    return {
      status: 'degraded' as const,
      ref: null,
      diagnostics: [
        {
          code: 'VERSION_DANGLING_REF',
          message: 'test ref not found',
          recoverability: 'retry',
        },
      ],
    };
  });
  const provider = {
    accessContext: {},
    readGraphRegistry: jest.fn(async () => ({
      status: 'ok' as const,
      registry,
      diagnostics: [],
    })),
    openGraph: jest.fn(async () => ({ namespace, readRef })),
  };
  return {
    versioning: {
      ...versionDomainSupportManifestRuntime(),
      provider,
      ...(input.merge ? { mergeService: { merge: input.merge } } : {}),
      writeService: {
        ...(input.fastForwardMerge ? { fastForwardMerge: input.fastForwardMerge } : {}),
        ...(input.mergeCommit ? { mergeCommit: input.mergeCommit } : {}),
      },
    },
  } as Parameters<typeof applyMergeWorkbookVersion>[0];
}

function cleanMergePreview(): VersionMergeResult {
  return {
    status: 'clean',
    base: BASE,
    ours: OURS,
    theirs: THEIRS,
    changes: [
      {
        structural: {
          kind: 'metadata',
          changeId: 'change:target-ref-cas',
          domain: 'cells.values',
          entityId: 'sheet-1!A1',
          propertyPath: ['value'],
        },
        base: { kind: 'value', value: null },
        ours: { kind: 'value', value: 'ours' },
        theirs: { kind: 'value', value: 'theirs' },
        merged: { kind: 'value', value: 'theirs' },
      },
    ],
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  };
}

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
