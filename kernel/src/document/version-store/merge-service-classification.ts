import type {
  VersionDiffValue,
  VersionMergeChange,
  VersionMergeConflict,
} from '@mog-sdk/contracts/api';

import type { MergeDiagnostic } from './merge-service-diagnostics';
import { canonicalJsonStringify } from './merge-apply-intent-store-json';
import { diagnostic } from './merge-service-diagnostics';
import {
  compareMergeChanges,
  compareMergeConflicts,
  mergeStableStructuralMetadata,
  stableMergeConflictIdentity,
  stableMergeResolutionOptions,
} from './merge-preview-evidence';
import {
  stableMergePairStructural,
  type SemanticValueChange,
} from './merge-service-semantic-records';

// Boundary: semantic record production owns domain-specific diff meaning. This
// service only reconciles canonical preview evidence into public merge results.
export async function classifyValueChanges(
  ours: readonly SemanticValueChange[],
  theirs: readonly SemanticValueChange[],
): Promise<
  | {
      readonly ok: true;
      readonly changes: readonly VersionMergeChange[];
      readonly conflicts: readonly VersionMergeConflict[];
    }
  | { readonly ok: false; readonly diagnostics: readonly MergeDiagnostic[] }
> {
  const changes: VersionMergeChange[] = [];
  const conflicts: VersionMergeConflict[] = [];
  const oursByKey = new Map(ours.map((change) => [change.key, change]));
  const consumedTheirs = new Set<string>();

  for (const oursChange of ours) {
    const theirsChange = theirs.find((candidate) => candidate.key === oursChange.key);
    if (!theirsChange) {
      changes.push({
        structural: oursChange.structural,
        base: oursChange.before,
        ours: oursChange.after,
        merged: oursChange.after,
        ...(oursChange.display ? { display: oursChange.display } : {}),
      });
      continue;
    }

    consumedTheirs.add(theirsChange.key);
    if (!semanticValuesEqual(oursChange.before, theirsChange.before)) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'VERSION_INVALID_COMMIT_PAYLOAD',
            'Merge preview found inconsistent base values for the same property.',
            { recoverability: 'repair' },
          ),
        ],
      };
    }

    const display = oursChange.display ?? theirsChange.display;
    const stablePairChange = {
      ...oursChange,
      structural: stableMergePairStructural(oursChange.structural, theirsChange.structural),
    };
    if (semanticValuesEqual(oursChange.after, theirsChange.after)) {
      changes.push({
        structural: await mergeStableStructuralMetadata(stablePairChange, theirsChange, 'clean'),
        base: oursChange.before,
        ours: oursChange.after,
        theirs: theirsChange.after,
        merged: oursChange.after,
        ...(display ? { display } : {}),
      });
      continue;
    }

    const structural = await mergeStableStructuralMetadata(
      stablePairChange,
      theirsChange,
      'conflict',
    );
    const identity = await stableMergeConflictIdentity(
      structural,
      oursChange.before,
      oursChange.after,
      theirsChange.after,
    );
    conflicts.push({
      conflictId: identity.conflictId,
      conflictDigest: identity.conflictDigest,
      conflictKind: 'same-property',
      structural,
      base: oursChange.before,
      ours: oursChange.after,
      theirs: theirsChange.after,
      resolutionOptions: await stableMergeResolutionOptions(
        identity,
        oursChange.before,
        oursChange.after,
        theirsChange.after,
      ),
      ...(display ? { display } : {}),
    });
  }

  for (const theirsChange of theirs) {
    if (oursByKey.has(theirsChange.key) || consumedTheirs.has(theirsChange.key)) continue;
    changes.push({
      structural: theirsChange.structural,
      base: theirsChange.before,
      theirs: theirsChange.after,
      merged: theirsChange.after,
      ...(theirsChange.display ? { display: theirsChange.display } : {}),
    });
  }

  changes.sort(compareMergeChanges);
  conflicts.sort(compareMergeConflicts);

  return { ok: true, changes, conflicts };
}

function semanticValuesEqual(left: VersionDiffValue, right: VersionDiffValue): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}
