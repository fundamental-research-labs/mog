import type { VersionDiffStructuralMetadata } from '@mog-sdk/contracts/api';

import type { VersionMergeCommitCaptureInput } from '../../../../../document/version-store/commit-service';
import {
  failedStoreResult,
  versionStoreDiagnostic,
  type VersionStoreFailure,
} from '../../../../../document/version-store/provider';
import { DEFAULT_MERGE_COMMIT_MATERIALIZER_KIND } from '../../merge/version-merge-materializer-support';

export function unsupportedMergeChange(
  input: VersionMergeCommitCaptureInput,
  index: number,
  structural: VersionDiffStructuralMetadata,
  details: Readonly<Record<string, string | number | boolean | null>> = {},
): { readonly ok: false; readonly failure: VersionStoreFailure } {
  return {
    ok: false,
    failure: failedStoreResult(
      [
        versionStoreDiagnostic('VERSION_MISSING_CHANGE_SET', {
          operation: 'commitGraphWrite',
          documentScope: input.provider.documentScope,
          namespace: input.namespace,
          refName: input.currentRef.name,
          commitId: input.ours,
          safeMessage:
            'Version merge materialization supports cell values, formulas, direct cell formats, row/column order changes, and sheet name/tab color/frozen pane metadata in this slice.',
          recoverability: 'unsupported',
          mutationGuarantee: 'no-write-attempted',
          details: {
            itemIndex: index,
            materializer: DEFAULT_MERGE_COMMIT_MATERIALIZER_KIND,
            structuralKind: structural.kind,
            domain: structural.kind === 'metadata' ? structural.domain : 'redacted',
            propertyPath:
              structural.kind === 'metadata' ? structural.propertyPath.join('.') : 'redacted',
            ...details,
          },
        }),
      ],
      'no-write-attempted',
    ),
  };
}
