import 'fake-indexeddb/auto';

import type { VersionDiagnostic } from '@mog-sdk/contracts/api';

import { WorkbookVersionImpl } from '../version';
import {
  BASE_COMMIT_ID,
  DOCUMENT_SCOPE,
  HEAD_COMMIT_ID,
  PRINCIPAL_SECRET,
  PRINCIPAL_OTHER,
  RAW_CELL_VALUE,
  SECRET_BRANCH,
  SECRET_DOMAIN,
  SECRET_PATH,
  SECRET_REF,
  SECRET_TABLE_ID,
  SECRET_TABLE_NAME,
  createReviewInput,
  digest,
  expectNoDiagnosticLeaks,
  providerWithRootAndChildReviewChanges,
  tableDefinitionValue,
  versionForProvider,
} from './version-review-provider-access-test-utils';
import { sanitizeReviewAccessDiagnostics } from '../../../document/version-store/review-access-projection';

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
});
