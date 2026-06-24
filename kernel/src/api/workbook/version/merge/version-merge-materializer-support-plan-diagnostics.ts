import type {
  VersionMergeChange,
  VersionMergeConflict,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import { unsupportedDiagnostic } from './version-merge-materializer-support-diagnostics';
import { inspectMaterializableMergeChange } from './version-merge-materializer-support-inspection';
import type { MergeMaterializationOperation } from './version-merge-materializer-support-types';

export function materializableMergePlanDiagnostics(
  input: {
    readonly changes: readonly VersionMergeChange[];
    readonly conflicts?: readonly VersionMergeConflict[];
  },
  operation: MergeMaterializationOperation,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  input.changes.forEach((change, itemIndex) => {
    const support = inspectMaterializableMergeChange(change);
    if (!support.ok) diagnostics.push(unsupportedDiagnostic(operation, itemIndex, support));
  });
  input.conflicts?.forEach((conflict, conflictIndex) => {
    for (const option of conflict.resolutionOptions) {
      const support = inspectMaterializableMergeChange({
        structural: conflict.structural,
        merged: option.value,
      });
      if (!support.ok) {
        diagnostics.push(
          unsupportedDiagnostic(operation, conflictIndex, support, {
            conflictId: conflict.conflictId,
            optionId: option.optionId,
          }),
        );
      }
    }
  });
  return diagnostics;
}
