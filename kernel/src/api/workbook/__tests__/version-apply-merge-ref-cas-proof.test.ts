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
import { VERSION_GRAPH_MAIN_REF } from '../../../document/version-store/graph-store';
import {
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
