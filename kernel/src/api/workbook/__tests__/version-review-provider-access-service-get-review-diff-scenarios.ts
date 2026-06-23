import { WorkbookVersionImpl } from '../version';
import {
  BASE_COMMIT_ID,
  DOCUMENT_SCOPE,
  HEAD_COMMIT_ID,
  PRINCIPAL_SECRET,
  RAW_CELL_VALUE,
  SECRET_DOMAIN,
  SECRET_PATH,
  digest,
  expectNoDiagnosticLeaks,
} from './version-review-provider-access-test-utils';

export function registerReviewProviderAccessServiceGetReviewDiffScenarios(): void {
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
}
