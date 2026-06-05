import type {
  PivotFieldArea,
  PivotFieldPlacementFlat,
  PivotTableConfig as DataPivotTableConfig,
} from '@mog-sdk/contracts/pivot';
import {
  KernelError,
  createPivotAmbiguousPlacementError,
} from '../../errors';
import { makePlacementId } from './identifiers';

type PivotFieldPlacement = PivotFieldPlacementFlat;

export function placementId(placement: PivotFieldPlacement): string {
  return (
    placement.placementId ||
    makePlacementId(
      placement.area,
      placement.calculatedFieldId ?? placement.fieldId,
      placement.position,
    )
  );
}

export function placementFieldName(
  config: DataPivotTableConfig,
  placement: PivotFieldPlacement,
): string {
  return (
    config.fields.find((field) => field.id === placement.fieldId)?.name ??
    config.calculatedFields?.find((field) => field.fieldId === placement.fieldId)?.name ??
    placement.fieldId
  );
}

export function placementReadout(
  config: DataPivotTableConfig,
  placement: PivotFieldPlacement,
): any {
  return {
    ...placement,
    placementId: placementId(placement),
    fieldName: placementFieldName(config, placement),
  };
}

export function resolvePlacement(
  config: DataPivotTableConfig,
  identifier: string,
  area: PivotFieldArea | null,
  operation: string,
): PivotFieldPlacement {
  const candidates = config.placements.filter((placement) => {
    if (area && placement.area !== area) return false;
    const id = placementId(placement);
    const fieldName = placementFieldName(config, placement);
    return (
      id === identifier ||
      placement.fieldId === identifier ||
      fieldName === identifier ||
      placement.displayName === identifier
    );
  });
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    throw createPivotAmbiguousPlacementError({
      pivotName: config.name ?? config.id,
      identifier,
      operation,
      candidates: candidates.map((placement) => placementId(placement)),
    });
  }
  throw new KernelError(
    'COMPUTE_ERROR',
    `${operation}: Pivot placement "${identifier}" not found`,
  );
}
