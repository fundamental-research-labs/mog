import 'fake-indexeddb/auto';

import type {
  ObjectDigest,
  VersionCreateReviewInput,
  VersionDiagnostic,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMergeConflict,
  VersionMergeResultId,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor as GraphVersionAuthor } from '@mog-sdk/contracts/versioning';

import { WorkbookVersionImpl } from '../version';
import { attachWorkbookVersioning } from '../version-wiring';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import { createMergePreviewArtifactRecord } from '../../../document/version-store/merge-attempt-artifacts';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';
import { mergeResultIdForPreviewDigest } from '../../../document/version-store/merge-attempt-artifacts';
import { sanitizeReviewAccessDiagnostics } from '../../../document/version-store/review-access-projection';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'w9-04-review-provider-access',
  principalScope: 'principal-owner',
};
const CREATED_AT = '2026-06-23T00:00:00.000Z';
const GRAPH_AUTHOR: GraphVersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'Reviewer',
};
const BASE_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}` as const;
const HEAD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}` as const;
const RAW_CELL_VALUE = 'RAW-CELL-VALUE-W9-04';
const SECRET_DOMAIN = 'cells.values.secret-domain';
const SECRET_PATH = 'changes[1].after.value';
const PRINCIPAL_SECRET = 'principal-secret';
const PRINCIPAL_OTHER = 'principal-other';
const SECRET_REF = 'refs/heads/w10-09-secret-review';
const SECRET_BRANCH = 'w10-09-secret-branch';
const SECRET_TABLE_ID = 'table:w10-09-secret';
const SECRET_TABLE_NAME = 'W10-09 Hidden Table';
const REVIEW_AUTHOR = { kind: 'user', trust: 'trusted', displayName: 'Reviewer' } as const;
const REDACTION_POLICY = {
  mode: 'default',
  redactSecrets: true,
  redactExternalLinks: true,
  redactAgentTrace: true,
} as const;

describe('WorkbookVersion provider review access hardening', () => {
  it('redacts principal mismatch and raw value diagnostics from attached review services', async () => {
    const version = new WorkbookVersionImpl({
      documentId: DOCUMENT_SCOPE.documentId,
      versioning: {
        reviewService: {
          getReview: async () => ({
            ok: false,
            error: {
              code: 'target_unavailable',
              target: 'workbook.version.getReview',
              diagnostics: [
                {
                  code: 'VERSION_PERMISSION_DENIED',
                  severity: 'error',
                  message: `Review principal mismatch: expected ${PRINCIPAL_SECRET}, got ${PRINCIPAL_OTHER}.`,
                  data: {
                    payload: {
                      deniedCapabilities: ['version:reviewRead'],
                      principalScope: PRINCIPAL_SECRET,
                      expectedPrincipalScope: PRINCIPAL_SECRET,
                      actualPrincipalScope: PRINCIPAL_OTHER,
                      domain: SECRET_DOMAIN,
                      path: SECRET_PATH,
                      value: RAW_CELL_VALUE,
                      before: RAW_CELL_VALUE,
                      after: RAW_CELL_VALUE,
                      publicReason: 'accessDenied',
                    },
                  },
                },
              ],
            },
          }),
        },
      },
    } as any);

    const result = await version.getReview({ reviewId: `review:sha256:${'a'.repeat(64)}` });

    expect(result).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PERMISSION_DENIED',
            message:
              'Review principal mismatch: expected redacted-principal, got redacted-principal.',
            data: {
              payload: expect.objectContaining({
                deniedCapabilities: ['version:reviewRead'],
                publicReason: 'accessDenied',
              }),
            },
          }),
        ],
      },
    });
    expectNoDiagnosticLeaks(result, [
      PRINCIPAL_SECRET,
      PRINCIPAL_OTHER,
      'principalScope',
      'expectedPrincipalScope',
      'actualPrincipalScope',
      SECRET_DOMAIN,
      SECRET_PATH,
      RAW_CELL_VALUE,
      '"value"',
      '"before"',
      '"after"',
    ]);
  });

  it('blocks partial-domain review diffs without leaking raw cell diagnostics', async () => {
    const version = new WorkbookVersionImpl({
      documentId: DOCUMENT_SCOPE.documentId,
      versioning: {
        reviewService: {
          getReviewDiff: async () => ({
            ok: true,
            value: {
              schemaVersion: 1,
              source: 'semantic-diff',
              baseCommitId: BASE_COMMIT_ID,
              headCommitId: HEAD_COMMIT_ID,
              changeSetDigest: digest('3'),
              changes: [
                {
                  target: {
                    kind: 'semanticChange',
                    changeId: 'visible-cell-change',
                    entityKind: 'cell',
                    entityId: 'sheet-1!A1',
                    propertyPath: ['value'],
                    derived: false,
                  },
                },
              ],
              summary: { authoredChanges: 1, derivedChanges: 0, redactedChanges: 0 },
              limit: 100,
              diagnostics: [
                {
                  code: 'indexKeyedVisibility',
                  severity: 'error',
                  message: `subset-hidden partial-domain diagnostic for ${PRINCIPAL_SECRET} and ${RAW_CELL_VALUE}`,
                  data: {
                    payload: {
                      category: 'subset-hidden',
                      domain: SECRET_DOMAIN,
                      omittedDomains: SECRET_DOMAIN,
                      omittedChangeCount: 1,
                      path: SECRET_PATH,
                      principalScope: PRINCIPAL_SECRET,
                      value: RAW_CELL_VALUE,
                      rawValue: RAW_CELL_VALUE,
                    },
                  },
                },
              ],
              upstreamDiff: {
                items: [
                  {
                    structural: {
                      kind: 'metadata',
                      changeId: 'visible-cell-change',
                      domain: 'cell',
                      entityId: 'sheet-1!A1',
                      propertyPath: ['value'],
                    },
                  },
                  {
                    structural: {
                      kind: 'metadata',
                      changeId: 'hidden-cell-change',
                      domain: SECRET_DOMAIN,
                      entityId: 'sheet-1!A2',
                      propertyPath: ['value'],
                    },
                    before: { kind: 'value', value: RAW_CELL_VALUE },
                    after: { kind: 'value', value: RAW_CELL_VALUE },
                  },
                ],
              },
            },
          }),
        },
      },
    } as any);

    const result = await version.getReviewDiff({
      baseCommitId: BASE_COMMIT_ID,
      headCommitId: HEAD_COMMIT_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.getReviewDiff',
        diagnostics: [
          expect.objectContaining({
            code: 'indexKeyedVisibility',
            message:
              'Review diff completeness diagnostics block review because authored domains may be hidden.',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                operation: 'getReviewDiff',
                source: 'reviewDiffCompleteness',
              }),
            }),
          }),
        ],
      },
    });
    expectNoDiagnosticLeaks(result, [
      PRINCIPAL_SECRET,
      SECRET_DOMAIN,
      SECRET_PATH,
      RAW_CELL_VALUE,
      'omittedDomains',
      'omittedChangeCount',
      '"domain"',
      '"path"',
      '"value"',
      '"rawValue"',
      'upstreamDiff',
    ]);
  });

  it('redacts raw values from provider review projection diagnostics', () => {
    const diagnostics = sanitizeReviewAccessDiagnostics([
      {
        code: 'VERSION_PERMISSION_DENIED',
        severity: 'error',
        message: `Denied ${PRINCIPAL_SECRET}.`,
        data: {
          payload: {
            deniedCapabilities: ['version:reviewRead'],
            principalScope: PRINCIPAL_SECRET,
            domain: SECRET_DOMAIN,
            path: SECRET_PATH,
            value: RAW_CELL_VALUE,
            cellValue: RAW_CELL_VALUE,
            publicReason: 'accessDenied',
          },
        },
      },
    ] satisfies readonly VersionDiagnostic[]);

    expect(diagnostics).toMatchObject([
      {
        code: 'VERSION_PERMISSION_DENIED',
        message: 'Denied redacted-principal.',
        data: {
          payload: expect.objectContaining({
            deniedCapabilities: ['version:reviewRead'],
            publicReason: 'accessDenied',
          }),
        },
      },
    ]);
    expectNoDiagnosticLeaks(diagnostics, [
      PRINCIPAL_SECRET,
      SECRET_DOMAIN,
      SECRET_PATH,
      RAW_CELL_VALUE,
      'principalScope',
      '"domain"',
      '"path"',
      '"value"',
      '"cellValue"',
    ]);
  });

  it('redacts hidden branch and ref diagnostics while preserving capability state', () => {
    const diagnostics = sanitizeReviewAccessDiagnostics([
      {
        code: 'VERSION_PERMISSION_DENIED',
        severity: 'error',
        message: `Capability state denied ${PRINCIPAL_SECRET} for ref ${SECRET_REF} branchName=${SECRET_BRANCH}.`,
        data: {
          payload: {
            capability: 'version:reviewRead',
            deniedCapabilities: ['version:reviewRead'],
            dependency: 'hostCapability',
            retryable: false,
            reason: 'hostCapabilityDenied',
            principalScope: PRINCIPAL_SECRET,
            targetRef: SECRET_REF,
            refName: SECRET_REF,
            branchName: SECRET_BRANCH,
            expectedTargetHead: {
              commitId: HEAD_COMMIT_ID,
              revision: 'rv:w10-09-secret',
            },
          },
        },
      },
    ] satisfies readonly VersionDiagnostic[]);

    expect(diagnostics).toMatchObject([
      {
        code: 'VERSION_PERMISSION_DENIED',
        message: 'Capability state denied redacted-principal for ref redacted-ref redacted-ref.',
        data: {
          payload: {
            capability: 'version:reviewRead',
            deniedCapabilities: ['version:reviewRead'],
            dependency: 'hostCapability',
            retryable: false,
            reason: 'hostCapabilityDenied',
          },
        },
      },
    ]);
    expectNoDiagnosticLeaks(diagnostics, [
      PRINCIPAL_SECRET,
      SECRET_REF,
      SECRET_BRANCH,
      HEAD_COMMIT_ID,
      'principalScope',
      'targetRef',
      'refName',
      'branchName',
      'expectedTargetHead',
    ]);
  });

  it('fails provider-backed review diffs closed when denied projections hide detail values', async () => {
    const graph = await providerWithRootAndChildReviewChanges(
      'denied-review-diff-detail-projection',
      [
        {
          changeId: 'change:w10-09-secret-table',
          domain: 'tables',
          entityId: SECRET_TABLE_ID,
          propertyPath: ['definition'],
          before: tableDefinitionValue('before'),
          after: { kind: 'redacted', reason: 'permission-denied' },
          hiddenRef: SECRET_REF,
          hiddenPrincipal: PRINCIPAL_SECRET,
        },
      ],
    );
    const version = versionForProvider(graph.provider);
    const review = await version.createReview(
      createReviewInput(
        'denied-review-diff-detail-projection',
        graph.rootCommitId,
        graph.childCommitId,
      ),
    );
    if (!review.ok) throw new Error(`expected review create success: ${review.error.code}`);

    const result = await version.getReviewDiff({ reviewId: review.value.id });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.getReviewDiff',
      },
    });
    expect(result).not.toHaveProperty('value');
    expectNoDiagnosticLeaks(result, [
      SECRET_TABLE_ID,
      SECRET_TABLE_NAME,
      SECRET_REF,
      PRINCIPAL_SECRET,
      'change:w10-09-secret-table',
      'hiddenRef',
      'hiddenPrincipal',
    ]);
  });

  it('redacts denied conflict detail diagnostics from provider artifact reads', async () => {
    const provider = await providerWithInitializedRegistry('denied-conflict-detail');
    const resultDigest = digest('8');
    const canaries = [
      PRINCIPAL_SECRET,
      `merge-result:${resultDigest.digest}`,
      `merge-payload:${resultDigest.digest}`,
      resultDigest.digest,
      'conflict:w9-04:secret',
      RAW_CELL_VALUE,
    ];
    const deniedProvider = {
      accessContext: { principalScope: PRINCIPAL_SECRET, diagnosticsAllowed: true },
      readGraphRegistry: () => provider.readGraphRegistry(),
      openGraph: async () => ({
        getObjectRecord: async () => {
          throw Object.assign(new Error(canaries.join(' ')), {
            diagnostics: [
              {
                issueCode: 'VERSION_PERMISSION_DENIED',
                safeMessage: `Denied conflict detail for ${canaries.join(' ')}`,
                payload: {
                  principalScope: PRINCIPAL_SECRET,
                  conflictId: 'conflict:w9-04:secret',
                  value: RAW_CELL_VALUE,
                },
              },
            ],
          });
        },
      }),
    };
    const version = new WorkbookVersionImpl({ versioning: { provider: deniedProvider } } as any);

    const result = await version.getMergeConflictDetail({
      ...mergeReviewBaseInput(resultDigest),
      conflictId: 'conflict:w9-04:secret',
      expectedConflictDigest: digest('9'),
      valueRole: 'base',
      purpose: 'review',
    });

    expectMergeReviewDiagnostic(
      result,
      'getMergeConflictDetail',
      'VERSION_PERMISSION_DENIED',
      'Version merge review is not authorized for this caller.',
    );
    expectNoDiagnosticLeaks(result, canaries);
  });

  it('rejects provider conflict detail when denied projections hide table definitions', async () => {
    const graphId = 'denied-conflict-detail-projection';
    const provider = await providerWithInitializedRegistry(graphId);
    const namespace = namespaceForDocumentScope(provider.documentScope, graphId);
    const graph = await provider.openGraph(namespace);
    const head = await graph.readHead();
    if (head.status !== 'success') throw new Error('expected initialized graph head');
    const oursCommit = await commitReviewFixture(graph, namespace, {
      expectedHeadCommitId: head.head.id,
      expectedMainRefVersion: head.head.refRevision as any,
      label: 'ours',
    });
    const theirsCommit = await commitReviewFixture(graph, namespace, {
      expectedHeadCommitId: oursCommit.commit.id,
      expectedMainRefVersion: oursCommit.main.revision,
      label: 'theirs',
    });
    const conflict = tableDefinitionConflict();
    const previewRecord = await createMergePreviewArtifactRecord(namespace, {
      status: 'conflicted',
      base: head.head.id,
      ours: oursCommit.commit.id,
      theirs: theirsCommit.commit.id,
      conflicts: [conflict],
    });
    const put = await graph.putObjects([previewRecord]);
    expect(put.status).toBe('success');
    const version = new WorkbookVersionImpl({ versioning: { provider } } as any);

    const result = await version.getMergeConflictDetail({
      resultId: mergeResultIdForReviewDigest(previewRecord.digest),
      resultDigest: previewRecord.digest,
      redactionPolicyDigest: previewRecord.digest,
      conflictId: conflict.conflictId,
      expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
      valueRole: 'theirs',
      purpose: 'review',
      targetRef: 'refs/heads/main' as any,
      expectedTargetHead: {
        commitId: oursCommit.commit.id,
        revision: oursCommit.main.revision,
      },
    });

    expectMergeReviewDiagnostic(
      result,
      'getMergeConflictDetail',
      'VERSION_INVALID_COMMIT_PAYLOAD',
      'Persisted merge preview artifact payload is invalid or unsupported.',
    );
    expectNoDiagnosticLeaks(result, [
      SECRET_TABLE_ID,
      SECRET_TABLE_NAME,
      SECRET_REF,
      PRINCIPAL_SECRET,
      conflict.conflictId,
      conflict.conflictDigest,
      previewRecord.digest.digest,
    ]);
  });

  it('redacts principal mismatch and saved-resolution payload refs in provider diagnostics', async () => {
    const resultDigest = digest('7');
    const payloadId = `merge-payload:${resultDigest.digest}`;
    const resultId = mergeResultIdForReviewDigest(resultDigest);
    const canaries = [
      PRINCIPAL_SECRET,
      PRINCIPAL_OTHER,
      payloadId,
      resultId,
      resultDigest.digest,
      `sha256:${resultDigest.digest}`,
      RAW_CELL_VALUE,
      SECRET_PATH,
    ];
    const deniedProvider = {
      accessContext: { principalScope: PRINCIPAL_SECRET, diagnosticsAllowed: true },
      readGraphRegistry: async () => ({
        status: 'unsupported',
        registry: null,
        diagnostics: [
          {
            issueCode: 'VERSION_PERMISSION_DENIED',
            recoverability: 'unsupported',
            safeMessage: `Principal mismatch ${canaries.join(' ')}`,
            payload: {
              principalScope: PRINCIPAL_SECRET,
              expectedPrincipalScope: PRINCIPAL_SECRET,
              actualPrincipalScope: PRINCIPAL_OTHER,
              payloadId,
              resolutionSetDigest: resultDigest.digest,
              value: RAW_CELL_VALUE,
              path: SECRET_PATH,
            },
          },
        ],
      }),
      openGraph: async () => {
        throw new Error('openGraph should not be called');
      },
    };
    const version = new WorkbookVersionImpl({ versioning: { provider: deniedProvider } } as any);

    const saved = await version.saveMergeResolutions({
      resultId,
      resultDigest,
      redactionPolicyDigest: resultDigest,
      resolutions: [],
    });
    const payload = await version.putMergeResolutionPayload({
      resultId,
      resultDigest,
      redactionPolicyDigest: resultDigest,
      conflictId: 'conflict:w9-04:payload-ref',
      expectedConflictDigest: digest('6'),
      optionId: 'option:w9-04:payload-ref',
      kind: 'acceptTheirs',
      targetRef: 'refs/heads/main',
      expectedTargetHead: {
        commitId: HEAD_COMMIT_ID,
        revision: 'rv:w9-04-head',
      },
      value: RAW_CELL_VALUE,
      purpose: 'chooseValue',
    });

    for (const [result, operation] of [
      [saved, 'saveMergeResolutions'],
      [payload, 'putMergeResolutionPayload'],
    ] as const) {
      expectMergeReviewDiagnostic(
        result,
        operation,
        'VERSION_PERMISSION_DENIED',
        'Version merge review is not authorized for this caller.',
      );
      expectNoDiagnosticLeaks(result, canaries);
    }
  });
});

function mergeReviewBaseInput(resultDigest: ObjectDigest): {
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: ObjectDigest;
  readonly redactionPolicyDigest: ObjectDigest;
} {
  return {
    resultId: mergeResultIdForReviewDigest(resultDigest),
    resultDigest,
    redactionPolicyDigest: resultDigest,
  };
}

function mergeResultIdForReviewDigest(digestValue: ObjectDigest): VersionMergeResultId {
  return mergeResultIdForPreviewDigest(digestValue as any);
}

function digest(digit: string): ObjectDigest {
  return { algorithm: 'sha256', digest: digit.repeat(64) };
}

function expectMergeReviewDiagnostic(
  value: unknown,
  operation: string,
  code: string,
  message: string,
): void {
  expect(value).toMatchObject({
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics: [
        expect.objectContaining({
          code,
          message,
          data: expect.objectContaining({
            redacted: true,
            payload: expect.objectContaining({ operation }),
          }),
        }),
      ],
    },
  });
}

function expectNoDiagnosticLeaks(value: unknown, canaries: readonly string[]): void {
  const serialized = JSON.stringify(value);
  for (const canary of canaries) {
    expect(serialized).not.toContain(canary);
  }
}

function versionForProvider(provider: ReturnType<typeof createInMemoryVersionStoreProvider>) {
  const ctx = { documentId: provider.documentScope.documentId } as any;
  attachWorkbookVersioning(ctx, { provider });
  return new WorkbookVersionImpl(ctx);
}

function createReviewInput(
  clientRequestId: string,
  baseCommitId: string,
  headCommitId: string,
): VersionCreateReviewInput {
  return {
    clientRequestId,
    subject: {
      kind: 'commitRange',
      baseCommitId: baseCommitId as VersionCreateReviewInput['baseCommitId'],
      headCommitId: headCommitId as VersionCreateReviewInput['headCommitId'],
    },
    baseCommitId: baseCommitId as VersionCreateReviewInput['baseCommitId'],
    headCommitId: headCommitId as VersionCreateReviewInput['headCommitId'],
    createdBy: REVIEW_AUTHOR,
    redactionPolicy: REDACTION_POLICY,
  };
}

async function providerWithRootAndChildReviewChanges(
  graphId: string,
  reviewChanges: readonly unknown[],
) {
  const documentScope = {
    ...DOCUMENT_SCOPE,
    documentId: `${DOCUMENT_SCOPE.documentId}-${graphId}`,
  };
  const provider = createInMemoryVersionStoreProvider({ documentScope });
  const initialized = await provider.initializeGraph(await initializeInput(graphId, documentScope));
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  const graph = await provider.openGraph(namespace);
  const head = await graph.readHead();
  if (head.status !== 'success') throw new Error('expected initialized graph head');
  const committed = await graph.commit({
    snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      label: 'child',
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
      schemaVersion: 1,
      changes: reviewChanges,
      reviewChanges,
    }),
    mutationSegmentRecords: [
      await objectRecord(namespace, 'workbook.mutationSegment.v1', {
        segmentId: 'child-segment-1',
      }),
    ],
    author: GRAPH_AUTHOR,
    createdAt: CREATED_AT,
    completenessDiagnostics: [],
    expectedHeadCommitId: head.head.id,
    expectedMainRefVersion: head.head.refRevision as any,
  });
  if (committed.status !== 'success') {
    throw new Error(`expected child commit success: ${JSON.stringify(committed.diagnostics)}`);
  }
  return {
    provider,
    rootCommitId: initialized.rootCommit.id,
    childCommitId: committed.commit.id,
  };
}

async function commitReviewFixture(
  graph: Awaited<ReturnType<ReturnType<typeof createInMemoryVersionStoreProvider>['openGraph']>>,
  namespace: VersionGraphNamespace,
  input: {
    readonly expectedHeadCommitId: string;
    readonly expectedMainRefVersion: unknown;
    readonly label: string;
  },
) {
  const committed = await graph.commit({
    snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      label: input.label,
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
      schemaVersion: 1,
      changes: [],
    }),
    mutationSegmentRecords: [
      await objectRecord(namespace, 'workbook.mutationSegment.v1', {
        segmentId: `${input.label}-segment`,
      }),
    ],
    author: GRAPH_AUTHOR,
    createdAt: CREATED_AT,
    completenessDiagnostics: [],
    expectedHeadCommitId: input.expectedHeadCommitId as any,
    expectedMainRefVersion: input.expectedMainRefVersion as any,
  });
  if (committed.status !== 'success') {
    throw new Error(`expected ${input.label} commit success: ${JSON.stringify(committed.diagnostics)}`);
  }
  return committed;
}

async function providerWithInitializedRegistry(graphId: string) {
  const documentScope = {
    ...DOCUMENT_SCOPE,
    documentId: `${DOCUMENT_SCOPE.documentId}-${graphId}`,
  };
  const provider = createInMemoryVersionStoreProvider({ documentScope });
  const initialized = await provider.initializeGraph(await initializeInput(graphId, documentScope));
  expectInitializeSuccess(initialized);
  return provider;
}

function tableDefinitionConflict(): VersionMergeConflict {
  const conflictId = 'conflict:w10-09:secret-table';
  const structural: VersionDiffStructuralMetadata = {
    kind: 'metadata',
    changeId: 'change:w10-09-secret-table',
    domain: 'tables',
    entityId: SECRET_TABLE_ID,
    propertyPath: ['definition'],
  };
  const base = tableDefinitionValue('base');
  const ours = tableDefinitionValue('ours');
  const theirs = { kind: 'redacted', reason: 'permission-denied' } as const;
  return {
    conflictId,
    conflictDigest: `sha256:${'a'.repeat(64)}`,
    conflictKind: 'same-property',
    structural,
    base,
    ours,
    theirs,
    resolutionOptions: [
      resolutionOption(conflictId, 'acceptOurs', ours),
      resolutionOption(conflictId, 'acceptTheirs', theirs),
      resolutionOption(conflictId, 'acceptBase', base),
    ],
  };
}

function resolutionOption(
  conflictId: string,
  kind: VersionMergeConflict['resolutionOptions'][number]['kind'],
  value: VersionDiffValue,
): VersionMergeConflict['resolutionOptions'][number] {
  return {
    optionId: `option:w10-09:${kind}`,
    conflictId,
    kind,
    value,
    recalcRequired: false,
  };
}

function tableDefinitionValue(name: string): VersionDiffValue {
  return {
    kind: 'value',
    value: {
      kind: 'object',
      fields: [
        { key: 'kind', value: 'tableDefinition' },
        { key: 'tableId', value: SECRET_TABLE_ID },
        { key: 'name', value: `${SECRET_TABLE_NAME} ${name}` },
        { key: 'sheetId', value: 'sheet-1' },
      ],
    },
  };
}

function conflictDigestObject(conflictDigest: string): ObjectDigest {
  if (!conflictDigest.startsWith('sha256:')) {
    throw new Error(`expected sha256 conflict digest: ${conflictDigest}`);
  }
  return { algorithm: 'sha256', digest: conflictDigest.slice('sha256:'.length) };
}

async function initializeInput(
  graphId: string,
  documentScope: VersionDocumentScope,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label: 'root',
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        schemaVersion: 1,
        changes: [],
      }),
      author: GRAPH_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

async function objectRecord(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.issueCode}`);
  }
}
