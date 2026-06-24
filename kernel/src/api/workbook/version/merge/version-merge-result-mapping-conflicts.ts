import type {
  VersionMergeConflict,
  VersionMergeConflictResolutionOption,
  VersionMergeConflictResolutionOptionKind,
} from '@mog-sdk/contracts/api';

import { mapGraphDiagnostics } from '../../version-merge-public-diagnostics';
import {
  mapDiffDisplay,
  mapDiffValue,
  mapStructuralMetadata,
} from './version-merge-result-mapping-values';
import { isRecord } from './version-merge-result-mapping-shared';

const VERSION_MERGE_RESOLUTION_OPTION_KINDS = new Set<VersionMergeConflictResolutionOptionKind>([
  'acceptOurs',
  'acceptTheirs',
  'acceptBase',
]);
const REQUIRED_VERSION_MERGE_RESOLUTION_OPTION_KINDS = [
  'acceptOurs',
  'acceptTheirs',
  'acceptBase',
] as const satisfies readonly VersionMergeConflictResolutionOptionKind[];

export function mapMergeConflicts(
  values: readonly unknown[],
): readonly VersionMergeConflict[] | null {
  const conflicts = values.map(mapMergeConflict);
  return conflicts.some((conflict) => conflict === null)
    ? null
    : (conflicts as VersionMergeConflict[]);
}

function mapMergeConflict(value: unknown): VersionMergeConflict | null {
  if (!isRecord(value) || value.conflictKind !== 'same-property') return null;

  const conflictId = typeof value.conflictId === 'string' ? value.conflictId : null;
  const conflictDigest = typeof value.conflictDigest === 'string' ? value.conflictDigest : null;
  const structural = mapStructuralMetadata(value.structural);
  const base = mapDiffValue(value.base);
  const ours = mapDiffValue(value.ours);
  const theirs = mapDiffValue(value.theirs);
  const resolutionOptions = Array.isArray(value.resolutionOptions)
    ? mapMergeResolutionOptions(value.resolutionOptions, conflictId)
    : null;
  if (
    conflictId === null ||
    conflictDigest === null ||
    !structural ||
    !base ||
    !ours ||
    !theirs ||
    !resolutionOptions
  ) {
    return null;
  }

  const display = value.display === undefined ? undefined : mapDiffDisplay(value.display);
  if (value.display !== undefined && !display) return null;
  const diagnostics = Array.isArray(value.diagnostics)
    ? mapGraphDiagnostics(value.diagnostics)
    : undefined;

  return {
    conflictId,
    conflictDigest,
    conflictKind: 'same-property',
    structural,
    base,
    ours,
    theirs,
    resolutionOptions,
    ...(display ? { display } : {}),
    ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

function mapMergeResolutionOptions(
  values: readonly unknown[],
  conflictId: string | null,
): readonly VersionMergeConflictResolutionOption[] | null {
  if (!conflictId) return null;
  const options = values.map((value) => mapMergeResolutionOption(value, conflictId));
  if (options.some((option) => option === null)) return null;
  const mapped = options as VersionMergeConflictResolutionOption[];
  const kinds = new Set(mapped.map((option) => option.kind));
  if (
    REQUIRED_VERSION_MERGE_RESOLUTION_OPTION_KINDS.some((kind) => !kinds.has(kind)) ||
    mapped.length !== kinds.size
  ) {
    return null;
  }
  return [...mapped].sort((left, right) => compareResolutionOptionKinds(left.kind, right.kind));
}

function mapMergeResolutionOption(
  value: unknown,
  conflictId: string,
): VersionMergeConflictResolutionOption | null {
  if (!isRecord(value)) return null;

  const optionId = typeof value.optionId === 'string' ? value.optionId : null;
  const optionConflictId = typeof value.conflictId === 'string' ? value.conflictId : null;
  const kind = isMergeResolutionOptionKind(value.kind) ? value.kind : null;
  const optionValue = mapDiffValue(value.value);
  const recalcRequired = typeof value.recalcRequired === 'boolean' ? value.recalcRequired : null;
  if (
    !optionId ||
    optionConflictId !== conflictId ||
    !kind ||
    !optionValue ||
    recalcRequired === null
  ) {
    return null;
  }

  const diagnostics = Array.isArray(value.diagnostics)
    ? mapGraphDiagnostics(value.diagnostics)
    : undefined;

  return {
    optionId,
    conflictId,
    kind,
    value: optionValue,
    recalcRequired,
    ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

function isMergeResolutionOptionKind(
  value: unknown,
): value is VersionMergeConflictResolutionOptionKind {
  return typeof value === 'string' && VERSION_MERGE_RESOLUTION_OPTION_KINDS.has(value as never);
}

function compareResolutionOptionKinds(
  left: VersionMergeConflictResolutionOptionKind,
  right: VersionMergeConflictResolutionOptionKind,
): number {
  return (
    REQUIRED_VERSION_MERGE_RESOLUTION_OPTION_KINDS.indexOf(left) -
    REQUIRED_VERSION_MERGE_RESOLUTION_OPTION_KINDS.indexOf(right)
  );
}
