import type { VersionMergeChange } from '@mog-sdk/contracts/api';

import { mapGraphDiagnostics } from '../../version-merge-public-diagnostics';
import {
  mapDiffDisplay,
  mapDiffValue,
  mapStructuralMetadata,
} from './version-merge-result-mapping-values';
import { isRecord } from './version-merge-result-mapping-shared';

export function mapMergeChanges(values: readonly unknown[]): readonly VersionMergeChange[] | null {
  const changes = values.map(mapMergeChange);
  return changes.some((change) => change === null) ? null : (changes as VersionMergeChange[]);
}

function mapMergeChange(value: unknown): VersionMergeChange | null {
  if (!isRecord(value)) return null;

  const structural = mapStructuralMetadata(value.structural);
  const base = mapDiffValue(value.base);
  const merged = mapDiffValue(value.merged);
  const ours = value.ours === undefined ? undefined : mapDiffValue(value.ours);
  const theirs = value.theirs === undefined ? undefined : mapDiffValue(value.theirs);
  if (
    !structural ||
    !base ||
    !merged ||
    (value.ours !== undefined && !ours) ||
    (value.theirs !== undefined && !theirs)
  ) {
    return null;
  }

  const display = value.display === undefined ? undefined : mapDiffDisplay(value.display);
  if (value.display !== undefined && !display) return null;
  const diagnostics = Array.isArray(value.diagnostics)
    ? mapGraphDiagnostics(value.diagnostics)
    : undefined;

  return {
    structural,
    base,
    ...(ours ? { ours } : {}),
    ...(theirs ? { theirs } : {}),
    merged,
    ...(display ? { display } : {}),
    ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
  };
}
