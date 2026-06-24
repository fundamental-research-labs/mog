import { namespaceForDocumentScope } from '../../../document/version-store/provider';
import {
  DEFAULT_MERGE_COMMIT_MATERIALIZER_KIND,
  createSemanticMergeCommitCapture,
} from '../version/merge/version-merge-materializer';
import {
  BASE,
  CREATED_AT,
  DOCUMENT_SCOPE,
  EXPECTED_TARGET_HEAD,
  OURS,
  TARGET_REF,
  THEIRS,
  sheetLifecycleNoopChange,
} from './version-apply-merge-materializer-support-test-utils';

describe('WorkbookVersion applyMerge materializer support boundary diagnostics', () => {
  it('returns materializer boundary diagnostics for unsupported no-op changes before hydration', async () => {
    const capture = createSemanticMergeCommitCapture({
      userTimezone: 'UTC',
      now: () => new Date(CREATED_AT),
    });

    const result = await capture({
      provider: { documentScope: DOCUMENT_SCOPE } as any,
      graph: {} as any,
      accessContext: {},
      namespace: namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-materializer-boundary'),
      registry: {} as any,
      currentRef: { name: TARGET_REF } as any,
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      targetRef: TARGET_REF as any,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
      changes: [sheetLifecycleNoopChange()],
      resolutionCount: 0,
    });

    expect(result).toMatchObject({
      status: 'failed',
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_MISSING_CHANGE_SET',
          details: expect.objectContaining({
            itemIndex: 0,
            materializer: DEFAULT_MERGE_COMMIT_MATERIALIZER_KIND,
            structuralKind: 'metadata',
            domain: 'sheet',
            propertyPath: 'sheet',
            reason: 'unsupportedStructuralMetadata',
            noop: true,
          }),
        }),
      ],
    });
  });
});
