import type { VersionDiffStructuralMetadata } from '@mog-sdk/contracts/api';

import type {
  MaterializableMergeStructural,
  SheetMetadataProperty,
} from './version-merge-materialization-plan-types';

type ParsedSheetMetadataStructural = MaterializableMergeStructural & {
  readonly propertyPath: readonly [SheetMetadataProperty];
};

export function parseCellStructural(
  structural: VersionDiffStructuralMetadata,
): MaterializableMergeStructural | null {
  if (structural.kind !== 'metadata') return null;
  if (
    structural.domain !== 'cell' &&
    structural.domain !== 'cells.values' &&
    structural.domain !== 'cells.formulas'
  ) {
    return null;
  }
  if (structural.domain === 'cells.formulas') {
    return structural.propertyPath.length === 0 ||
      (structural.propertyPath.length === 1 &&
        (structural.propertyPath[0] === 'formula' || structural.propertyPath[0] === 'value'))
      ? structural
      : null;
  }
  if (
    structural.propertyPath.length !== 0 &&
    !(structural.propertyPath.length === 1 && structural.propertyPath[0] === 'value')
  ) {
    return null;
  }
  return structural;
}

export function parseDirectFormatStructural(
  structural: VersionDiffStructuralMetadata,
): MaterializableMergeStructural | null {
  if (structural.kind !== 'metadata') return null;
  if (structural.domain !== 'cells.formats.direct') return null;
  if (structural.propertyPath.length !== 1 || structural.propertyPath[0] !== 'format') {
    return null;
  }
  return structural;
}

export function parseRowColumnStructural(
  structural: VersionDiffStructuralMetadata,
): MaterializableMergeStructural | null {
  if (structural.kind !== 'metadata') return null;
  if (structural.domain !== 'rows-columns') return null;
  if (structural.propertyPath.length !== 1 || structural.propertyPath[0] !== 'order') {
    return null;
  }
  return structural;
}

export function parseSheetMetadataStructural(
  structural: VersionDiffStructuralMetadata,
): ParsedSheetMetadataStructural | null {
  if (structural.kind !== 'metadata') return null;
  if (structural.domain !== 'sheet' && structural.domain !== 'sheets') return null;
  if (structural.propertyPath.length !== 1) return null;
  const property = structural.propertyPath[0];
  return property === 'name' || property === 'tabColor' || property === 'frozen'
    ? (structural as ParsedSheetMetadataStructural)
    : null;
}

export function isViewStateStructural(structural: VersionDiffStructuralMetadata): boolean {
  return structural.kind === 'metadata' && structural.domain === 'view-state';
}
