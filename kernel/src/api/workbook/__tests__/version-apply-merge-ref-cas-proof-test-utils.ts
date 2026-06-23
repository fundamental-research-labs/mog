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

import type { applyMergeWorkbookVersion } from '../version-apply-merge';
import type { recoverPersistedMergeApplyPostCas } from '../version-apply-merge-recovery';
import { versionDomainSupportManifestRuntime } from './version-domain-support-test-utils';
import { VERSION_GRAPH_MAIN_REF } from '../../../document/version-store/graph-store';
import type {
  computeMergeApplyRefCasProof,
  MergeApplyIntentRecord,
  MergeApplyIntentStore,
} from '../../../document/version-store/merge-apply-intent-store';
import {
  createVersionGraphRegistry,
  namespaceForDocumentScope,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import { versionGraphNamespaceKey } from '../../../document/version-store/object-store';
import { versionDocumentScopeKey } from '../../../document/version-store/registry';

export const DOCUMENT_SCOPE: VersionDocumentScope = { documentId: 'vc07-ref-cas-proof' };
export const CREATED_AT = '2026-06-21T00:00:00.000Z';
export const BASE = commitId('0');
export const OURS = commitId('1');
export const THEIRS = commitId('2');
export const MERGE = commitId('6');
export const ADVANCED = commitId('7');
export const RESULT_DIGEST = digest('3');
export const RESOLVED_ATTEMPT_DIGEST = digest('4');
export const RESOLUTION_SET_DIGEST = digest('5');
export const RESULT_ID = `merge-result:${RESOLVED_ATTEMPT_DIGEST.digest}` as VersionMergeResultId;
export const TARGET_REF = VERSION_GRAPH_MAIN_REF as VersionMainRefName;
export const EXPECTED_TARGET_HEAD: VersionCommitExpectedHead = {
  commitId: OURS,
  revision: { kind: 'counter', value: '1' },
};

export async function publicApplyContext(input: {
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

export function cleanMergePreview(): VersionMergeResult {
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

export function fastForwardIntentRecord(
  namespace: ReturnType<typeof namespaceForDocumentScope>,
): MergeApplyIntentRecord {
  return mergeApplyIntentRecord(namespace, 'fastForward');
}

export function mergeCommitIntentRecord(
  namespace: ReturnType<typeof namespaceForDocumentScope>,
): MergeApplyIntentRecord {
  return mergeApplyIntentRecord(namespace, 'mergeCommit');
}

export function recoveryContext(input: {
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

export function providerErrorDiagnosticForTest(): VersionStoreDiagnostic {
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

export function resolutionMismatchDiagnosticForTest(safeMessage: string): VersionStoreDiagnostic {
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

function commitId(seed: string): WorkbookCommitId {
  return `commit:sha256:${seed.repeat(64)}` as WorkbookCommitId;
}

function digest(seed: string) {
  return { algorithm: 'sha256' as const, digest: seed.repeat(64) };
}
