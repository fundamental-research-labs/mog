import { describe, expect, it } from '@jest/globals';
import type { VersionMergeChange } from '@mog-sdk/contracts/api';

import type { VersionMergeCommitCaptureInput } from '../../../document/version-store/commit-service';
import { namespaceForDocumentScope } from '../../../document/version-store/provider';
import type { VersionDocumentScope } from '../../../document/version-store/provider';
import { parseMergeChanges } from '../version/apply-merge/materialization-plan/version-merge-materialization-plan';
import {
  BASE,
  EXPECTED_TARGET_HEAD,
  OURS,
  TARGET_REF,
  THEIRS,
  metadata,
} from './version-apply-merge-test-utils';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  documentId: 'vc07-apply-merge-materialization-plan-view-state',
};

describe('WorkbookVersion applyMerge materialization plan view-state support', () => {
  it('rejects view-state merge changes with an explicit unsupported diagnostic before writes', () => {
    const input = {
      provider: { documentScope: DOCUMENT_SCOPE },
      graph: {},
      accessContext: {},
      namespace: namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-view-state'),
      registry: {},
      currentRef: { name: TARGET_REF },
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      targetRef: TARGET_REF,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
      changes: [viewStateSelectionScrollChange()],
      resolutionCount: 0,
    } as unknown as VersionMergeCommitCaptureInput;

    const result = parseMergeChanges(input);

    expect(result).toMatchObject({
      ok: false,
      failure: {
        status: 'failed',
        mutationGuarantee: 'no-write-attempted',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_MISSING_CHANGE_SET',
            recoverability: 'unsupported',
            mutationGuarantee: 'no-write-attempted',
            details: expect.objectContaining({
              itemIndex: 0,
              structuralKind: 'metadata',
              domain: 'view-state',
              propertyPath: 'selection.scroll',
              reason: 'unsupportedViewState',
              matrixRowId: 'view-state.selection-scroll',
              capturePolicy: 'excluded',
            }),
          }),
        ],
      },
    });
  });
});

function viewStateSelectionScrollChange(): VersionMergeChange {
  return {
    structural: metadata('merge-view-state-selection-scroll', 'sheet-1', 'view-state', [
      'selection',
      'scroll',
    ]),
    base: { kind: 'value', value: 'A1' },
    theirs: { kind: 'value', value: 'C4' },
    merged: { kind: 'value', value: 'C4' },
  };
}
