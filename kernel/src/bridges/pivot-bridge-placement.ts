import type {
  AggregateFunction as ApiAggregateFunction,
  CalculatedFieldId,
  PivotFieldArea as ApiPivotFieldArea,
  PivotTableConfig,
  PivotTupleKey,
  PlacementId,
  ShowValuesAsConfig as ApiShowValuesAsConfig,
  SortOrder,
} from '@mog-sdk/contracts/pivot';

export type PublicPivotPlacement = PivotTableConfig['placements'][number];

export type PivotBridgePlacementSpec = {
  placementId?: PlacementId;
  fieldId?: string;
  area: ApiPivotFieldArea;
  position?: number;
  source?:
    | { type: 'field'; fieldId: string }
    | { type: 'calculatedField'; calculatedFieldId: CalculatedFieldId };
  aggregateFunction?: ApiAggregateFunction;
  sortOrder?: SortOrder;
  displayName?: string;
  showValuesAs?: ApiShowValuesAsConfig;
  numberFormat?: string;
};

export type PivotBridgePlacementPatch = Partial<
  Omit<PivotBridgePlacementSpec, 'placementId' | 'area' | 'source'>
>;

export type PivotBridgeInternalPlacementPatch = PivotBridgePlacementPatch &
  Partial<Pick<PublicPivotPlacement, 'sortByValue'>>;

export function placementId(value: string): PlacementId {
  return value as PlacementId;
}

export function pivotTupleKey(value: string): PivotTupleKey {
  return value as PivotTupleKey;
}

export function getBridgePlacementId(placement: PublicPivotPlacement): PlacementId {
  return (
    placement.placementId ??
    placementId(`${placement.area}:${placement.fieldId}:${placement.position}`)
  );
}

export function createStablePlacementId(
  pivotId: string,
  area: ApiPivotFieldArea,
  fieldId: string,
  position: number,
  existingPlacements: readonly PublicPivotPlacement[],
): PlacementId {
  const existing = new Set(existingPlacements.map((placement) => getBridgePlacementId(placement)));
  const base = `${pivotId}:${area}:${fieldId}:${position}`;
  if (!existing.has(placementId(base))) {
    return placementId(base);
  }
  let suffix = 1;
  while (existing.has(placementId(`${base}:${suffix}`))) {
    suffix += 1;
  }
  return placementId(`${base}:${suffix}`);
}

export function getPlacementCalculatedFieldId(
  placement: PublicPivotPlacement | PivotBridgePlacementSpec,
): CalculatedFieldId | undefined {
  if ('calculatedFieldId' in placement && typeof placement.calculatedFieldId === 'string') {
    return placement.calculatedFieldId;
  }
  if ('source' in placement && placement.source?.type === 'calculatedField') {
    return placement.source.calculatedFieldId;
  }
  return undefined;
}

export function toPublicSortOrder(
  sortOrder: SortOrder | undefined,
): PublicPivotPlacement['sortOrder'] {
  return sortOrder === 'none' ? undefined : sortOrder;
}

export function normalizePlacementPatch(
  patch: PivotBridgeInternalPlacementPatch,
): Partial<PublicPivotPlacement> {
  const { sortOrder, ...rest } = patch;
  const normalized: Partial<PublicPivotPlacement> = { ...rest };
  if ('sortOrder' in patch) {
    normalized.sortOrder = toPublicSortOrder(sortOrder);
  }
  return normalized;
}

export function placementsInArea(
  placements: readonly PublicPivotPlacement[],
  area: ApiPivotFieldArea,
): PublicPivotPlacement[] {
  return placements
    .map((placement, originalIndex) => ({ placement, originalIndex }))
    .filter(({ placement }) => placement.area === area)
    .sort(
      (left, right) =>
        left.placement.position - right.placement.position ||
        left.originalIndex - right.originalIndex,
    )
    .map(({ placement }) => ({ ...placement }));
}

export function renumberPlacements(placements: PublicPivotPlacement[]): PublicPivotPlacement[] {
  return placements.map((placement, position) => ({ ...placement, position }));
}

export function clampPlacementPosition(position: number, length: number): number {
  if (!Number.isFinite(position)) return length;
  return Math.max(0, Math.min(Math.trunc(position), length));
}
